/* =====================================================================
 * OCR ENGINE — Mesin OCR murni (tanpa UI)
 *
 * Bisa dijalankan di konteks DOM mana pun (offscreen document / tab).
 * Satu-satunya dependensi: window.Tesseract (tesseract.min.js) yang
 * harus di-load lebih dulu di host, plus chrome.runtime.getURL('lib/').
 *
 * Menghasilkan:
 *  - detectFromImage(url, pool, blob)  → hasil kode tiket (pure)
 *  - processAllText(url)               → hasil OCR teks bebas (NAMA/RRN)
 *  - initWorkers(pool) / warmWorkers() → manajemen pool worker
 * ===================================================================== */

/* Versi engine — harus SINKRON dengan OCR_CODE_VERSION di modules/bg-ocr.js.
   Disertakan di setiap hasil OCR (engineVersion) agar bisa dibuktikan versi
   mana yang benar-benar menjalankan scan (offscreen doc tidak reload sendiri;
   tab preview selalu memuat file terbaru). Kalau versi livechat < versi
   preview → offscreen masih engine lama → reload extension. */
export var OCR_ENGINE_VERSION = 'v3.46';

import { getTokens, extractCodes, getAllBestCodes, sharpen, invert, enhanceContrast, adaptiveDilate, removeSpecks, calculateOptimalScale, findBlankCut, splitCanvasV } from './ocr-common.js';/* ---- Varian OCR kode tiket ----
   HANYA PSM 3 (fully automatic, baca SEMUA blok) — dipilih user: akurasi tertinggi
   (default Tesseract), menangkap baris di manapun termasuk yang tersebar/berukuran
   beda. Model best (lib/best/) mencegah digit tertukar (3↔5, 8↔0).
   KALAU ingin dua varian paralel (PSM 6 + PSM 3), tambahkan kembali baris dil ps6
   di bawah ini (sinkronkan juga popup.js). */
export var VARIANTS = [
  { label: 'dil ps3', prep: 'dilated', psm: '3', whitelist: '0123456789+', engine: '1', dpi: 200 },
];

/* ---- Batas tinggi canvas untuk chunking potret HP ---- */
var CHUNK_HEIGHT = 2500; /* > 2500px → bagi jadi irisan vertikal, OCR per irisan */

/* ---- OVERRIDE CROP MANUAL (dipilih user di OCR Preview) ----
   Screenshot 1920×1080 dipotong PERSIS area ini (bukan center 600×1080 lagi).
   Nilai diambil dari editor crop OCR Preview (INSTRUKSI OCR — AREA MANUAL).
   Ubah nilai di sini untuk mengubah area; set null untuk kembali ke aturan lama.
   Berlaku SEMUA jalur OCR (livechat, dashboard, offscreen) — blob 1920×1080 dari
   mana pun harus dipotong area yang sama. Sinkronkan juga dengan applyAutoCrop
   di pages/ocr-preview.js agar preview tetap jujur. */
/* OVERRIDE CROP MANUAL per resolusi — daftar area pilihan user (PERSIS INSTRUKSI OCR).
   Instruksi user TERBARU: SEMUA gambar di-crop strip KIRI 50% + prep Invert, KECUALI
   gambar kecil (lebar < PHONE_CROP.minW → seluruh gambar diproses) dan gambar desktop
   (1920×1080 / 1920×794 → area kustom tetap). Karena itu hanya 2 entry desktop + 5
   entry gambar kecil yang aktif di daftar ini; semua resolusi potret lain jatuh ke
   PHONE_CROP (strip kiri 50%) + smart auto-scale sampai bestcode.
   Setiap entry: srcW/srcH = dimensi SUMBER screenshot yang cocok, cx/cy/cw/ch = area potong.
   Pencocokan TOLERANSI: |lebar−srcW| ≤ TOL_W (4) DAN |tinggi−srcH| ≤ TOL_H (6) — varian
   browser chrome/DPR beberapa piksel tetap masuk aturan. Entry strip tinggi penuh
   (cy=0 & ch=srcH) memakai TINGGI AKTUAL gambar yang cocok.
   Field OPSIONAL scale = zoom DIPATOK per-resolusi (menang atas setting global
   'ocrCropScale'; tanpa scale → ikut setting). SEMUA entry memakai prep: ['invert']
   (Invert — instruksi user: SEMUA aturan). Field prep bisa juga ARRAY tahap lain
   (mis. ['sharpen'] = hanya Sharpen); jalur non-override (tanpa aturan) juga Invert.
   Berlaku SEMUA jalur OCR (livechat, dashboard, offscreen) —
   blob berukuran cocok harus dipotong area yang sama. Sinkronkan juga dengan applyAutoCrop
   di pages/ocr-preview.js (TOL_W/TOL_H & crop.scale di cropScaleFor). */
var TOL_W = 4, TOL_H = 6; /* toleransi ukuran crop manual — harus SINKRON dengan applyAutoCrop */
var MANUAL_CROPS = [
  /* HANYA 2 ENTRY DESKTOP — gambar kecil tidak lagi punya entry per-resolusi:
     SEMUA gambar kecil (< PHONE_CROP.minW) disamakan → FULL gambar + prep Invert
     + skala otomatis (calculateOptimalScale) + smart auto-scale (instruksi user
     terbaru: "gambar kecil full gambar invert dan auto scale disamakan saja").
     Sumber BESAR/TINGGI (mis. 1280×2772) TIDAK di-crop — TAPI cap pixel pass
     utama dilonggarkan ke 12MP (lihat maxPixels di bawah) agar discan ×1.50
     penuh, persis pemenang demo (1920×4158 — instruksi user terbaru). */
  /* 1920×1080: LANDSCAPE DESKTOP — area KUSTOM x693,y231 · 237×560 (6% gambar)
     dengan zoom DIPATOK ×2.60 (DPI 250 — DIPERBESAR, 616×1456 / canvas 620×1460)
     dan prep Invert — persis INSTRUKSI OCR user terbaru. Kotak TETAP. */
  { srcW: 1920, srcH: 1080, cx: 693, cy: 231, cw: 237, ch: 560, scale: 2.6, prep: ['invert'] },
  /* 1920×794: LANDSCAPE WIDE (jarang) — area KUSTOM x737,y0 · 451×794 (23% gambar)
     dengan zoom DIPATOK ×2.00 (DPI 192 — 902×1588 / canvas 906×1592) dan prep Invert
     — persis INSTRUKSI OCR user terbaru. Kotak TETAP (cy 0, ch = srcH). */
  { srcW: 1920, srcH: 794, cx: 737, cy: 0, cw: 451, ch: 794, scale: 2.0, prep: ['invert'] },
  /* 1080×2400: POTRET HP PORTRAIT (Android high-res) — SELURUH gambar (x0,y0 · 1080×2400,
     full, tidak dicrop — instruksi user "seluruh gambar") dengan zoom DEFAULT DIPATOK
     ×2.30 (DPI 221 — 2484×5520 / canvas 2488×5524), prep Invert. maxPixels dilonggarkan
     (14MP) agar ×2.30 tidak ter-cap oleh cap 12MP gambar besar (yang memberi ~×2.15),
     persis INSTRUKSI user terbaru. */
  { srcW: 1080, srcH: 2400, cx: 0, cy: 0, cw: 1080, ch: 2400, scale: 2.3, prep: ['invert'], maxPixels: 14000000 },
];

/* ---- CROP STRIP KIRI 50% (SEMUA gambar, kecuali kecil & desktop) ----
   Instruksi user TERBARU: SEMUA gambar (potret maupun non-potret) dipotong strip
   KIRI 50% × tinggi penuh — di sanalah kolom kode tiket + user ID + bestcode
   (pola 720×1600 yang diuji user: x=0, y=0, 361×1600 → "50% dari gambar").
   KECUALI: ukuran kecil (lebar < minW — strip terlalu sempit untuk kode 19 digit;
   SELURUH gambar diproses + Invert + auto-scale, aturan DISAMAKAN untuk semua
   gambar kecil — tidak ada lagi zoom dipatok per-resolusi), sumber BESAR (lebar
   ≥ bigMinW DAN tinggi ≥ bigMinH, mis. 1440×3200 — instruksi user: "gambar ukuran
   besar jangan di crop", seluruh gambar diproses), dan gambar TINGGI (tinggi
   > TALL_MIN_H, mis. 828×1792 — instruksi user: "tinggi diatas 1700 berarti ikut
    tanpa crop seperti gambar besar lainnya", seluruh gambar diproses), dan    resolusi yang punya MANUAL_CROPS sendiri (desktop 1920×1080/1920×794 & potret
    HP 1080×2400 — override full dengan zoom dipatok).
   Crop manual user mengirim noPhoneCrop=true → dilewati (area sudah dipilih manual).
   Ubah minW/ratio/bigMinW/bigMinH/bigScale/TALL_MIN_H di sini; sinkronkan juga
   dengan applyAutoCrop + PHONE_CROP_BIG di pages/ocr-preview.js.
   Zoom strip mengikuti setting 'ocrCropScale' (Perbesaran OCR di preview, default
   1.5); sumber BESAR & gambar TINGGI (tanpa crop) memakai skala otomatis
   calculateOptimalScale. Setelah pass utama, smart auto-scale menaikkan zoom
   terus sampai bestcode ('+Ambil') terbaca. Set PHONE_CROP = null untuk kembali
   ke aturan lama. */
var PHONE_CROP = { minW: 600, ratio: 0.5, bigMinW: 1000, bigMinH: 2000, bigScale: 1 };

/* Gambar TINGGI (tinggi > TALL_MIN_H) diperlakukan SAMA seperti sumber BESAR:
   TIDAK di-crop, seluruh gambar diproses, skala otomatis, smart auto-scale mulai
   dari ×0.5 (instruksi user: "tinggi diatas 1700 berarti ikut tanpa crop seperti
   gambar besar lainnya"). */
var TALL_MIN_H = 1700;
function isBigOrTall(w, h) {
  return (w >= (PHONE_CROP.bigMinW || 1000) && h >= (PHONE_CROP.bigMinH || 2000)) || h > TALL_MIN_H;
}

/* ---- Zoom maksimal area crop (diatur user di OCR Preview) ----
   Nilai dibaca dari chrome.storage.local 'ocrCropScale' (default 1.5). Preview
   menulisnya saat user mengubah "Perbesaran OCR"; engine (livechat/dashboard/
   offscreen/preview) membacanya di SETIAP scan agar hasilnya SAMA persis dengan
   yang dilihat user. Tidak di-cache agar perubahan langsung berlaku. */
function getCropScaleSetting() {
  /* Mengembalikan { value, from } — from = 'storage' (terbaca dari storage) atau
     'fallback' (baca gagal / nilai tidak valid → default 1.5). Sumber dipakai untuk
     diagnostik preview vs livechat (kenapa zoom selalu 1.5 di satu jalur). */
  return new Promise(function(resolve) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('ocrCropScale', function(r) {
          var v = parseFloat(r && r.ocrCropScale);
          /* Minimum ×1.0 (instruksi user terbaru) — setting 0.5 ke bawah TIDAK valid
             lagi: main pass & start auto-scale tidak pernah di bawah ×1.0. */
          if (!isNaN(v) && v >= 1.0 && v <= 4) resolve({ value: v, from: 'storage' });
          else resolve({ value: 1.5, from: 'fallback' });
        });
      } else resolve({ value: 1.5, from: 'fallback' });
    } catch(e) { resolve({ value: 1.5, from: 'fallback' }); }
  });
}

var workers = [];
var workers2 = [];
var WORKERS_PER_POOL = 4; /* 4 worker per pool — percepatan maksimal: batch climb 4 scan sekaligus. Trade-off: 8 worker best bila LiveChat + dashboard aktif (memori lebih besar). Recycle otomatis tiap 30 scan. */
var bestWorkers = [];  /* pool 0 model 'best' (lib/best/) — akurasi digit tertinggi. */
var bestWorkers2 = []; /* pool 1 model 'best' — slot kedua dashboard, terpisah dari pool 0
                          agar dual-scan tetap paralel (pola sama workers/workers2). */
/* Semua jalur OCR (auto-scan, crop, eskalasi, popup, bridge NAMA/RRN)
   memakai model best; fallback ke standar hanya bila model best gagal dimuat. */
/* Pin core SIMD-LSTM secara eksplisit. Auto-deteksi Tesseract.js bisa memilih
   tesseract-core-relaxedsimd*.wasm yang pasangan glue/wasm-nya TIDAK cocok di
   project ini → error "missing function: _ZN9tesseract13DotProductSSEEPKfS1_i". */
var CORE_FILE = 'tesseract-core-simd-lstm.wasm.js';
var CORE_FILE_FALLBACK = 'tesseract-core-lstm.wasm.js'; /* non-SIMD — bila SIMD tidak didukung CPU/browser */

/* ---- Mode WAJIB SIMD (instruksi user) ----
   Semua worker dibuat lewat createTessWorker → satu titik kontrol. Sebelum
   membuat worker, deteksi dukungan WebAssembly SIMD SEKALI (di-cache):
     1) browser mendukung simd128 (WebAssembly.validate dengan tipe v128)?
     2) file core SIMD (tesseract-core-simd-lstm.wasm) ada & bisa dikompilasi
        (menangkap file rusak/terpotong saat disalin DAN CPU/VM tanpa instruksi
        SIMD — WebAssembly.compile gagal di lingkungan tanpa dukungan).
   Kebijakan:
     - SIMD tersedia → core SIMD (seperti dulu).
     - SIMD TIDAK tersedia:
         * default / ocrAllowNoSimd=false → BLOCK OCR dengan pesan jelas
           (mencegah jalan lambat di core non-SIMD tanpa disadari).
         * ocrAllowNoSimd=true (chrome.storage.local) → fallback core non-SIMD.
   Setting dibaca per pembuatan worker (tidak di-cache lama). */
var _simdStatus = null;
var _simdAllowOverride = null; /* null = baca storage; true/false = dipaksa pemanggil (SW baca storage → dikirim ke offscreen) */
function detectSimdSupport() {
  if (_simdStatus) return _simdStatus;
  _simdStatus = (async function() {
    /* 1) Browser: WebAssembly SIMD — probe modul minimal dengan tipe hasil v128 */
    try {
      if (typeof WebAssembly === 'undefined' || typeof WebAssembly.validate !== 'function') {
        return { ok: false, reason: 'browser', message: 'WebAssembly tidak didukung browser ini.' };
      }
      var simdProbe = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123]);
      if (!WebAssembly.validate(simdProbe)) {
        return { ok: false, reason: 'browser', message: 'Browser tidak mendukung WebAssembly SIMD (perlu Chrome 91+). Update Chrome ke versi terbaru.' };
      }
    } catch (e) {
      return { ok: false, reason: 'browser', message: 'Gagal memeriksa WebAssembly SIMD: ' + ((e && e.message) || e) };
    }
    /* 2) File core SIMD: ada & bisa dikompilasi (file rusak / CPU tanpa instruksi) */
    var wasmUrl = chrome.runtime.getURL('lib/' + CORE_FILE.replace(/\.js$/, ''));
    var resp;
    try {
      resp = await fetch(wasmUrl);
    } catch (e) {
      return { ok: false, reason: 'file', message: 'Gagal membaca file core SIMD: ' + wasmUrl + ' — ' + ((e && e.message) || e) + '. Salin ulang folder extension utuh, lalu reload extension.' };
    }
    if (!resp.ok) {
      return { ok: false, reason: 'file', message: 'File core SIMD tidak ditemukan: ' + wasmUrl + ' — salin ulang folder extension utuh, lalu reload extension.' };
    }
    try {
      var bytes = await resp.arrayBuffer();
      await WebAssembly.compile(bytes);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'cpu', message: 'Core SIMD gagal dikompilasi — file wasm rusak atau CPU/VM tidak mendukung instruksi SIMD (AVX2/SSE4.1). Salin ulang folder, jangan akses lewat VM/RDP, lalu reload extension. Detail: ' + ((e && e.message) || e) };
    }
  })();
  return _simdStatus;
}

function getSimdPolicy(overrideHint) {
  /* true = izinkan fallback core non-SIMD; false (default) = wajib SIMD (blokir).
     Prioritas: hint snapshot saat pembuatan worker (anti-race 2 scan) → override
     eksplisit dari pemanggil (SW baca storage → kirim ke offscreen) → baca storage
     sendiri (offscreen tidak bisa diandalkan membaca storage — pola cropScale). */
  return new Promise(function(resolve) {
    if (typeof overrideHint === 'boolean') { resolve(!!overrideHint); return; }
    if (_simdAllowOverride !== null) { resolve(!!_simdAllowOverride); return; }
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('ocrAllowNoSimd', function(r) { resolve(!!(r && r.ocrAllowNoSimd)); });
      } else resolve(false);
    } catch(e) { resolve(false); }
  });
}

/* Buat worker Tesseract dengan core yang di-pin (SIMD-LSTM). Jika core SIMD gagal
   dimuat (CPU/browser tanpa SIMD), TIDAK langsung fallback — ikut kebijakan wajib
   SIMD: blokir dengan pesan jelas, kecuali ocrAllowNoSimd=true. */
async function createTessWorker(langPath) {
  var T = window.Tesseract;
  if (!T) { console.warn('ocr-engine: Tesseract not loaded'); return null; }
  var _simdPolicyHint = _simdAllowOverride; /* snapshot saat entry — anti-race nilai override dari scan lain yang berjalan bersamaan */
  var base = chrome.runtime.getURL('lib/');
  var opts = {
    workerPath: base + 'worker-shim.js', corePath: base + CORE_FILE,
    langPath: langPath || base, gzip: false, workerBlobURL: false,
    cacheMethod: 'none', logger: function(){}
  };
  var simd = await detectSimdSupport();
  if (!simd.ok) {
    var allow = await getSimdPolicy(_simdPolicyHint);
    console.warn('ocr-engine: SIMD tidak tersedia (' + simd.reason + ') — ' + (allow ? 'fallback non-SIMD (izin manual)' : 'OCR diblokir (wajib SIMD)'));
    if (!allow) {
      throw new Error('OCR diblokir (mode wajib SIMD): ' + simd.message + ' — Solusi: 1) update Chrome, 2) salin ulang folder extension utuh, 3) jangan akses lewat VM/RDP, atau izinkan non-SIMD: chrome.storage.local.set({ocrAllowNoSimd:true}) di console service worker.');
    }
    try {
      return await T.createWorker('eng', undefined, {
        workerPath: base + 'worker-shim.js', corePath: base + CORE_FILE_FALLBACK,
        langPath: langPath || base, gzip: false, workerBlobURL: false,
        cacheMethod: 'none', logger: function(){}
      });
    } catch (e2) {
      console.warn('ocr-engine: core fallback juga gagal', e2 && e2.message);
      throw e2;
    }
  }
  try {
    return await T.createWorker('eng', undefined, opts);
  } catch (e) {
    /* SIMD core gagal dimuat walau pre-check sukses (kasus langka) — ikut kebijakan */
    var allow2 = await getSimdPolicy(_simdPolicyHint);
    console.warn('ocr-engine: core SIMD gagal dimuat', e && e.message);
    if (!allow2) {
      throw new Error('OCR diblokir (mode wajib SIMD): core SIMD gagal dimuat saat runtime. ' + ((e && e.message) || '') + ' — Salin ulang folder extension utuh, atau izinkan non-SIMD: chrome.storage.local.set({ocrAllowNoSimd:true}).');
    }
    try {
      return await T.createWorker('eng', undefined, {
        workerPath: base + 'worker-shim.js', corePath: base + CORE_FILE_FALLBACK,
        langPath: langPath || base, gzip: false, workerBlobURL: false,
        cacheMethod: 'none', logger: function(){}
      });
    } catch (e2) {
      throw e2;
    }
  }
}

function preprocessImage(blob) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      URL.revokeObjectURL(img.src);
      var scale = 2, maxDim = 4000;
      var w = img.naturalWidth, h = img.naturalHeight;
      if (w > h && w * scale > maxDim) scale = maxDim / w;
      else if (h * scale > maxDim) scale = maxDim / h;
      w = Math.round(w * scale); h = Math.round(h * scale);
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, w, h);
      binarizeAdaptive(canvas);
      var id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      sharpen(id);
      ctx.putImageData(id, 0, 0);
      resolve(canvas);
    };
    img.onerror = function() { URL.revokeObjectURL(img.src); resolve(blob); };
    img.src = URL.createObjectURL(blob);
  });
}

function binarizeAdaptive(canvas) {
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var w = canvas.width, h = canvas.height;
  var imageData = ctx.getImageData(0, 0, w, h);
  var d = imageData.data;
  var len = d.length;
  var n = len / 4;
  var hist = new Int32Array(256);
  var sum = 0;
  for (var i = 0; i < len; i += 4) {
    var gray = (0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]) | 0;
    d[i] = d[i+1] = d[i+2] = gray;
    hist[gray]++;
    sum += gray;
  }
  var mean = sum / n;
  var total = n, sumB = 0, wB = 0, wF = 0;
  var maxVariance = 0, threshold = mean > 128 ? mean * 0.85 : mean * 1.15;
  for (var t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    var mB = sumB / wB;
    var mF = (sum - sumB) / wF;
    var variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) { maxVariance = variance; threshold = t; }
  }
  if (threshold > 180) threshold = 180;
  for (var i = 0; i < len; i += 4) {
    var val = d[i] > threshold ? 255 : 0;
    d[i] = d[i+1] = d[i+2] = val;
  }
  ctx.putImageData(imageData, 0, 0);
}

async function initWorkers(pool) {
  var w = pool === 1 ? workers2 : workers;
  if (w.length === WORKERS_PER_POOL) return;
  if (!window._initWorkerPromise) window._initWorkerPromise = {};
  if (window._initWorkerPromise[pool]) return window._initWorkerPromise[pool];
  window._initWorkerPromise[pool] = (async function() {
    if (!window._dashboardScanCount) window._dashboardScanCount = { p0: 0, p1: 0 };
    var key = pool === 1 ? 'p1' : 'p0';
    window._dashboardScanCount[key]++;
    if (window._dashboardScanCount[key] >= 30) {
      try {
        for (var rci = 0; rci < w.length; rci++) { w[rci].terminate().catch(function() {}); }
        w.length = 0;
        window._dashboardScanCount[key] = 0;
      } catch(e) {}
    }
    var needed = WORKERS_PER_POOL - w.length;
    var T = window.Tesseract;
    if (!T) { console.warn('ocr-engine: Tesseract not loaded'); return; }
    var base = chrome.runtime.getURL('lib/');
    async function makeWorker() {
      return await createTessWorker(base);
    }
    var promises = [];
    for (var i = 0; i < needed; i++) promises.push(makeWorker());
    var newWorkers = await Promise.all(promises);
    for (var i = 0; i < newWorkers.length; i++) w.push(newWorkers[i]);
    setTimeout(warmWorkers, 200);
  })();
  try { return await window._initWorkerPromise[pool]; }
  finally { delete window._initWorkerPromise[pool]; }
}

/* Worker model 'best' (lib/best/eng.traineddata) — kualitas tinggi, DIPAKAI DI SEMUA jalur.
   Font screenshot kadang membuat angka 3 terbaca 5 pada model standar;
   model best mengenali digit jauh lebih akurat (trade-off: lebih lambat). */
async function initBestWorkers(pool) {
  pool = pool || 0;
  var w = pool === 1 ? bestWorkers2 : bestWorkers;
  if (!window._initBestWorkerPromise) window._initBestWorkerPromise = {};
  if (window._initBestWorkerPromise[pool]) return window._initBestWorkerPromise[pool];
  /* Recycle setiap 30 scan — cegah akumulasi memori worker LSTM yang besar.
     Dijalankan SEBELUM early-return agar counter terakumulasi di setiap scan. */
  if (!window._bestScanCount) window._bestScanCount = { p0: 0, p1: 0 };
  var key = pool === 1 ? 'p1' : 'p0';
  window._bestScanCount[key]++;
  if (window._bestScanCount[key] >= 30) {
    try {
      for (var rci = 0; rci < w.length; rci++) { w[rci].terminate().catch(function() {}); }
      w.length = 0;
      window._bestScanCount[key] = 0;
    } catch(e) {}
  }
  if (w.length >= WORKERS_PER_POOL) return;
  window._initBestWorkerPromise[pool] = (async function() {
    var T = window.Tesseract;
    if (!T) { console.warn('ocr-engine: Tesseract not loaded'); return; }
    var base = chrome.runtime.getURL('lib/');
    async function makeBest() {
      return await createTessWorker(base + 'best/');
    }
    var needed = WORKERS_PER_POOL - w.length;
    var promises = [];
    for (var i = 0; i < needed; i++) promises.push(makeBest());
    var newWorkers = await Promise.all(promises);
    for (var i = 0; i < newWorkers.length; i++) w.push(newWorkers[i]);
    // Warm-up setelah dibuat — cegah cold-start pada pemakaian pertama
    setTimeout(function() { for (var wi = 0; wi < w.length; wi++) warmWorker(w[wi]); }, 200);
  })();
  try { return await window._initBestWorkerPromise[pool]; }
  finally { delete window._initBestWorkerPromise[pool]; }
}

function warmWorkers() {
  /* Warm-up semua pool secara independen — pool best adalah pool utama semua jalur OCR. */
  try {
    for (var wi = 0; wi < workers.length; wi++) warmWorker(workers[wi]);
  } catch(e) {}
  try {
    for (var bi = 0; bi < bestWorkers.length; bi++) warmWorker(bestWorkers[bi]);
  } catch(e) {}
  try {
    for (var b2i = 0; b2i < bestWorkers2.length; b2i++) warmWorker(bestWorkers2[b2i]);
  } catch(e) {}
}

/* Hash piksel canvas (FNV-1a, SEMUA piksel) — dipakai membuktikan apakah livechat &
   preview mengirim CANVAS YANG SAMA ke Tesseract. Hash sama → piksel identik (beda
   hasil OCR berarti gambar SUMBER berbeda); hash beda → ada beda di jalur crop/pipeline
   → harus diinvestigasi. SEMUA piksel di-hash (bukan sampling) karena beda yang dicari
   justru noise lokal kecil di sekitar simbol + yang bisa lolos dari sampling 1/20 px.
   Dihitung SETELAH preprocessing, jadi persis yang dilihat Tesseract. */
function canvasHash(cv) {
  var ctx = cv.getContext('2d', { willReadFrequently: true });
  var id = ctx.getImageData(0, 0, cv.width, cv.height).data;
  var h = 2166136261;
  for (var i = 0; i < id.length; i += 4) {
    h ^= id[i]; h = Math.imul(h, 16777619);
    h ^= id[i + 1]; h = Math.imul(h, 16777619);
    h ^= id[i + 2]; h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/* Warm-up satu worker: recognize canvas kecil agar cold-start Tesseract tidak
   terjadi di scan pertama yang asli. Hanya SEKALI per worker (flag _warmed) —
   keepalive tiap 30 detik TIDAK akan mengulang warm-up (hemat CPU). */
function warmWorker(w) {
  try {
    if (!w || !w.recognize || w._warmed) return;
    w._warmed = true;
    var cw = document.createElement('canvas'); cw.width = 32; cw.height = 16;
    var ctxw = cw.getContext('2d'); ctxw.fillStyle = '#fff'; ctxw.fillRect(0,0,cw.width,cw.height); ctxw.fillStyle = '#000'; ctxw.font = '12px monospace'; ctxw.fillText('2222222222', 0, 12);
    w.recognize(cw, { tessedit_pageseg_mode: '6' }).catch(function(){});
  } catch(e) {}
}



/* Skor hasil OCR — prioritas kode tiket 19 digit valid (extractCodes) + bestcode.
   CERDAS: selain kode penuh, beri kredit parsial untuk potongan digit & konteks
   nilai taruhan '+' — pencarian smart auto-scale bisa KONVERGEN ke scale yang
   paling banyak membaca digit (bukan cuma hitam-putih "ada kode / tidak ada").
   Sama dengan scoreOcrText di pages/ocr-preview.js (auto-search demo). */
function scoreOcrText(text) {
  if (!text) return 0;
  var codes = [];
  extractCodes(text).forEach(function(c) { if (codes.indexOf(c) === -1) codes.push(c); });
  var score = codes.length * 100000;
  var bestCodes = getAllBestCodes(text.split('\n').filter(Boolean), codes, false);
  score += bestCodes.length * 400000;
  getTokens(text).forEach(function(t) {
    if (t.length >= 16 && t[0] === '2') score += 5000;
    else if (t.length >= 10 && t[0] === '2') score += 300;
    else if (t.length >= 10) score += 60;
    score += Math.min(t.length, 12);
  });
  text.split('\n').forEach(function(ln) {
    if (/\+[\s]*[0-9.,]+/.test(ln)) score += 1500;
    var d = (ln.match(/\d/g) || []).length;
    var nd = (ln.match(/[^0-9\s]/g) || []).length;
    if (d > 0 && nd > d * 2) score -= 400;
  });
  if (text.replace(/\s/g, '').length < 8) score -= 20000;
  if (text.length > 4000) score -= 800;
  return score;
}

/* ---- OCR kode tiket (pure, selalu mengembalikan hasil) ---- */
async function detectFromImage(url, pool, blob, opts) {
  pool = pool || 0;
  var isCrop = !!(opts && opts.noAutoCrop); /* hasil crop user → jangan kena auto-crop screenshot */
  var noPhone = !!(opts && opts.noPhoneCrop); /* hasil crop MANUAL user → jangan kena PHONE_CROP (strip kiri 50%) */
  /* Kebijakan SIMD per scan: override eksplisit (dikirim SW) menang atas baca storage sendiri */
  _simdAllowOverride = (opts && typeof opts.allowNoSimd === 'boolean') ? opts.allowNoSimd : null;
  /* zoom maks area crop: override eksplisit (dikirim preview, sudah sesuai kalkulator
     termasuk aturan potret BESAR ×1) MENANG; selain itu baca setting storage 'ocrCropScale'. */
  var cropScaleFrom = 'explicit'; /* zoom dikirim eksplisit oleh pemanggil (preview) */
  var cropScale;
  if (opts && opts.cropScale) {
    cropScale = opts.cropScale;
  } else {
    var _cs = await getCropScaleSetting();
    cropScale = _cs.value; cropScaleFrom = _cs.from;
  }
  /* Clamp GARDU TERAKHIR: setting Perbesaran OCR TIDAK pernah di bawah ×1.0
     (instruksi user) — menang atas nilai eksplisit & storage apa pun sumbernya,
     jadi main pass & start auto-scale konsisten minimal ×1.0. */
  cropScale = Math.max(1.0, Math.min(parseFloat(cropScale) || 1.5, 4));
  var _t0 = Date.now();
  /* ALL-BEST: semua jalur OCR (auto-scan, crop, eskalasi, popup,
     bridge NAMA/RRN) memakai model 'best' (lib/best/) — akurasi digit tertinggi.
     Fallback ke model standar hanya jika model best gagal dimuat. */
  var pw = pool === 1 ? bestWorkers2 : bestWorkers;
  if (!url.startsWith('http') && !url.startsWith('blob:')) {
    return { codes: [], codeInfo: {}, bestCodes: [], lines: [], passages: [], allRaw: '', text: '', elapsed: '', rawTexts: [], error: 'URL tidak valid' };
  }
  var _blob = blob;
  if (!_blob) {
    try {
      var imgResp = await fetch(url, { mode: 'cors' });
      if (!imgResp.ok) throw new Error('HTTP ' + imgResp.status);
      _blob = await imgResp.blob();
    } catch (e) {
      return { codes: [], codeInfo: {}, bestCodes: [], lines: [], passages: [], allRaw: '', text: '', elapsed: '', rawTexts: [], error: 'Gagal unduh' };
    }
  }

  var allCodeMap = {}, allLines = [], allRaw = '';
  var prepCache = {};
  var prepDpiMap = {};
  var procInfo = { scale: 0, cw: 0, ch: 0, sw: 0, sh: 0, src: '', hash: '' }; /* info canvas yang BENAR-BENAR dikirim ke Tesseract; src = sumber zoom (explicit/storage/fallback/pinned); hash = sidik piksel canvas akhir */

  async function getPrep(name) {
    if (prepCache[name]) return prepCache[name];
    prepCache[name] = (async function() {
      var img;
      var wasOverride = false; /* true jika gambar dipotong oleh MANUAL_CROPS → diperlakukan seperti crop user (cap Perbesaran OCR) */
      var procScaleSrc = cropScaleFrom; /* sumber zoom aktual untuk diagnostik; jadi 'pinned' bila mc.scale dipakai */
      var wasPhone = false;     /* true jika gambar dipotong oleh PHONE_CROP → diperlakukan seperti crop user (cap 1.5×) */
      try { img = await createImageBitmap(_blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); } catch(e) { return preprocessImage(_blob); /* jalur fallback langka (jarang terjadi) */ }
      /* Lebar SUMBER ASLI (sebelum crop manual/PHONE_CROP) — dipakai auto-scale
         gambar kecil: lebar asli < PHONE_CROP.minW berarti gambar SUMBER kecil,
         bukan strip hasil crop potret HP (yang bisa tipis tapi sumbernya besar). */
      procInfo.srcW = img.width;
      procInfo.srcH = img.height;      /* OVERRIDE CROP MANUAL — screenshot berukuran cocok dipotong PERSIS area pilihan user.
         Instruksi user TERBARU: SEMUA gambar strip kiri 50% + Invert, KECUALI kecil
         (< minW — FULL gambar) & desktop. Daftar ini HANYA berisi 2 entry desktop:
         1920×1080 → x693,y231 · 237×560 ×2.6 dan 1920×794 → x737,y0 · 451×794 ×2.0 —
         SEMUA prep: ['invert']. Gambar kecil TIDAK punya entry (aturan disamakan: FULL
         gambar + Invert + skala otomatis + smart auto-scale). Resolusi lain
         (potret/non-potret) jatuh ke PHONE_CROP strip kiri 50% + smart auto-scale sampai
         bestcode. Dijalankan TANPA syarat isCrop agar berlaku juga untuk livechat (data
         URL penuh, isCrop=false setelah perbaikan flag). Set MANUAL_CROPS = [] untuk
         kembali ke aturan lama. */
      var mc = null;
      for (var mci = 0; mci < MANUAL_CROPS.length; mci++) {
        var mce = MANUAL_CROPS[mci];
        /* Toleransi ±TOL_W/±TOL_H — varian chrome/DPR beberapa piksel tetap masuk aturan
           (sinkron dengan applyAutoCrop di pages/ocr-preview.js). */
        var mceTolH = (mce.tolH != null) ? mce.tolH : TOL_H; /* toleransi tinggi per-entry (mis. keluarga 720×16xx ±18) */
        if (Math.abs(img.width - mce.srcW) <= TOL_W && Math.abs(img.height - mce.srcH) <= mceTolH) { mc = mce; break; }
      }
      if (mc) {
        /* Strip tinggi penuh (cy=0 & ch=srcH): pakai TINGGI AKTUAL gambar yang cocok —
           varian 720×1608/1612 tidak terpotong; kotak tetap (1920×1080, 828×1792) tetap
           ukuran tetap, di-clamp ke batas gambar. */
        var mcw = Math.min(mc.cw, img.width - mc.cx);
        var mch = (mc.cy === 0 && mc.ch === mc.srcH) ? img.height : Math.min(mc.ch, img.height - mc.cy);
        var mcCanvas = document.createElement('canvas');
        mcCanvas.width = mcw; mcCanvas.height = mch;
        mcCanvas.getContext('2d').drawImage(img, mc.cx, mc.cy, mcw, mch, 0, 0, mcw, mch);
        img.close();
        var mcBlob = await new Promise(function(res) { mcCanvas.toBlob(res, 'image/png'); });
        img = await createImageBitmap(mcBlob);
        wasOverride = true;
      }
      // Auto-crop fallback: landscape 1920×1080 → crop center 600×1080 (hanya bila MANUAL_CROPS kosong).
      // SKIP jika ini hasil crop user.
      if (!isCrop && img.width === 1920 && img.height === 1080) {
        var cropCanvas = document.createElement('canvas');
        cropCanvas.width = 600; cropCanvas.height = 1080;
        cropCanvas.getContext('2d').drawImage(img, 660, 0, 600, 1080, 0, 0, 600, 1080);
        img.close();
        var cropBlob = await new Promise(function(res) { cropCanvas.toBlob(res, 'image/png'); });
        img = await createImageBitmap(cropBlob);
      }
      // CROP STRIP KIRI 50% (SEMUA ukuran, kecuali kecil < minW, sumber BESAR
      // ≥ bigMinW×bigMinH, gambar TINGGI > TALL_MIN_H & desktop/override): di
      // sanalah kolom kode tiket + user ID + bestcode (pola 720×1600 yang diuji
      // user: x0,y0 · 361×1600). Dijalankan TANPA syarat isCrop — livechat
      // mengirim screenshot penuh sebagai data URL (isCrop=false setelah perbaikan
      // flag) tapi gambarnya full, jadi override/strip tetap kena. Crop manual
      // user mengirim noPhoneCrop=true → dilewati. Ukuran kecil (lebar <
      // PHONE_CROP.minW), sumber BESAR & gambar TINGGI (instruksi user) TIDAK
      // di-crop — seluruh gambar diproses.
      var phoneSrcW = 0, phoneSrcH = 0; /* dimensi SUMBER asli sebelum crop strip — untuk aturan zoom per-resolusi */
      var isBigSrc = isBigOrTall(img.width, img.height);
      if (!noPhone && !wasOverride && PHONE_CROP && img.width >= PHONE_CROP.minW && !isBigSrc) {
        phoneSrcW = img.width; phoneSrcH = img.height;
        var pcw = Math.floor(img.width * PHONE_CROP.ratio) + 1;
        var phoneCanvas = document.createElement('canvas');
        phoneCanvas.width = pcw; phoneCanvas.height = img.height;
        phoneCanvas.getContext('2d').drawImage(img, 0, 0, pcw, img.height, 0, 0, pcw, img.height);
        img.close();
        var phoneBlob = await new Promise(function(res) { phoneCanvas.toBlob(res, 'image/png'); });
        img = await createImageBitmap(phoneBlob);
        wasPhone = true;
      }
      var calc = calculateOptimalScale(img.width, img.height);
      var scale = calc.scale;
      var maxPixels = isBigSrc ? 12000000 : 5000000; /* SUMBER BESAR/TINGGI tanpa crop:
         cap 12MP (sama dengan climb & demo auto-search) — 1280×2772 full discan ×1.50
         (1920×4158), bukan dipatok 5MP (×1.19) yang mengecilkan teks → kode tiket
         tidak akurat. Pemenang demo persis resep ini (INSTRUKSI user terbaru). */
      /* Entry MANUAL_CROPS boleh melonggarkan cap-nya sendiri (mis. 1080×2400 ×2.30 →
         2484×5520 ≈ 13.7MP — perlu 14MP agar tidak ter-cap ~×2.15). */
      if (mc && mc.maxPixels) maxPixels = mc.maxPixels;
      var maxScalePixels = Math.sqrt(maxPixels / (img.width * img.height));
      // Crop user / MANUAL_CROPS / PHONE_CROP: pakai zoom PERSIS setting user ('ocrCropScale',
      // default 1.5) — bukan auto-calculateOptimalScale — agar preview = produksi (tunduk
      // pixel cap 5MP). Gambar non-crop tetap memakai skala otomatis.
      if (isCrop || wasOverride || wasPhone) {
        /* Zoom per aturan — urutan prioritas:
           1) mc.scale (MANUAL_CROPS) → zoom DIPATOK per-resolusi (mis. 450×800 → ×2.4),
              menang atas setting global — src='pinned' agar diagnostik jujur.
           2) potret BESAR (sumber ≥ bigMinW×bigMinH, mis. 1440×3200) → PHONE_CROP.bigScale
              (×1 — teks sudah besar, tanpa upscale).
           3) sisanya → setting 'ocrCropScale' (Perbesaran OCR, default 1.5), SAMA dengan
              override 1920×1080 & crop manual supaya livechat = preview. */
        var areaCap;
        if (mc && mc.scale) {
          areaCap = mc.scale;
          procScaleSrc = 'pinned';
        } else if (wasPhone && PHONE_CROP) {
          var isBigPhone = isBigOrTall(phoneSrcW, phoneSrcH);
          areaCap = isBigPhone ? (PHONE_CROP.bigScale || 1) : cropScale;
        } else {
          areaCap = cropScale;
        }
        scale = Math.min(areaCap, maxScalePixels);
      } else if (scale > maxScalePixels) {
        scale = maxScalePixels;
      }
      prepDpiMap[name] = Math.round(96 * scale);
      var sw = Math.round(img.width * scale);
      var sh = Math.round(img.height * scale);
      var PAD = 2; /* padding 2px di semua sisi (border putih) — dipilih user (sebelumnya 0, sekarang dikembalikan) */
      if (!window._sharedCanvasPool) window._sharedCanvasPool = [];
      var c = window._sharedCanvasPool.length ? window._sharedCanvasPool.pop() : document.createElement('canvas');
      c.width = sw + PAD * 2; c.height = sh + PAD * 2;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      var srcW = img.width, srcH = img.height;
      ctx.drawImage(img, PAD, PAD, sw, sh);
      img.close();
      /* Simpan info canvas aktual (area crop + zoom) — dipakai untuk diagnostik
         livechat vs preview (kenapa + terdeteksi di satu tempat, tidak di lain). */
      procInfo = { scale: scale, cw: srcW, ch: srcH, sw: sw, sh: sh, src: procScaleSrc,
        srcW: procInfo.srcW || srcW, srcH: procInfo.srcH || srcH }; /* srcW/srcH = lebar/tinggi SUMBER asli (sebelum crop) — dipakai auto-scale gambar kecil */
      /* Single preprocessing — instruksi user terbaru: SEMUA aturan memakai prep          Invert (prep: ['invert']); PHONE_CROP (wasPhone, tanpa mc) & gambar
         non-override (tanpa aturan) juga ikut Invert. DILEWATI bila pemanggil mengirim
         noPrep eksplisit (preview — blob sudah dicrop di preview, mc tidak ter-match
         di engine). */
      var mcPrepKeys = (mc && Array.isArray(mc.prep)) ? mc.prep : null;
      /* PHONE_CROP tidak punya mc — ikut resep Invert (semua jalur pakai Invert). */
      if (!mcPrepKeys && wasPhone) mcPrepKeys = ['invert'];
      var prepOff = !!(mc && mc.prep === 'none') || !!(opts && opts.noPrep);
      var id = ctx.getImageData(0, 0, c.width, c.height);
      if (mcPrepKeys) {
        if (mcPrepKeys.indexOf('specks') !== -1) removeSpecks(id);
        if (mcPrepKeys.indexOf('dilate') !== -1) adaptiveDilate(id, srcW, srcH);
        if (mcPrepKeys.indexOf('contrast') !== -1) enhanceContrast(id, 0.01);
        if (mcPrepKeys.indexOf('sharpen') !== -1) sharpen(id);
        if (mcPrepKeys.indexOf('invert') !== -1) invert(id);
      } else if (!prepOff) {
        invert(id); /* gambar non-override (tanpa aturan) — SEMUA jalur pakai Invert (instruksi user) */
      }
      ctx.putImageData(id, 0, 0);
      procInfo.hash = canvasHash(c); /* sidik piksel SETELAH preprocessing — persis yang dilihat Tesseract */
      return c;
    })();
    return prepCache[name];
  }

  var prepPromises = VARIANTS.map(function(v) { return getPrep(v.prep); });
  var canvases = await Promise.all(prepPromises);

  /* Best wajib untuk semua jalur — jika gagal dimuat, fallback ke standar. */
  try { await initBestWorkers(pool); }
  catch(e) { await initWorkers(pool); pw = pool === 1 ? workers2 : workers; }

  var results = [];
  var variantAllText = {};
  function buildPassages(resArr, allText) {
    var out = [], seen = {};
    resArr.forEach(function(r) {
      if (seen[r.label]) return;
      seen[r.label] = true;
      var full = (allText[r.label] || r.text).split('\n').filter(Boolean);
      out.push({ label: r.label, lines: full, codes: extractCodes(full.join('\n')) });
    });
    return out;
  }
  function processResult(pr) {
    var _q = pr.quality || 1; /* kualitas sumber: 1 = pass utama best, 2 = eskalasi/climb (zoom, akurasi tertinggi) */
    var codes = extractCodes(pr.text);
    codes.forEach(function(c) {
      if (!allCodeMap[c]) allCodeMap[c] = { count: 0, sources: [], quality: 0 };
      allCodeMap[c].count++;
      if (_q > allCodeMap[c].quality) allCodeMap[c].quality = _q;
      if (allCodeMap[c].sources.indexOf(pr.variant.label)===-1) allCodeMap[c].sources.push(pr.variant.label);
    });
    if (codes.length > 0) { allLines = allLines.concat(pr.text.split('\n').filter(Boolean)); allRaw += '\n── ' + pr.variant.label + ' ──\n' + pr.text; }
    /* Tembok separator antar hasil OCR (pass utama, eskalasi) di variantAllText
       juga — getAllBestCodes (splitPassBlocks) memakai baris '── label ──' sebagai batas.
       Tanpa ini, fallback yang membaca variantAllText (buildPassages/varLines) tetap bisa
       kena bug "29965+ menarik kode dari pass lain". */
    variantAllText[pr.variant.label] = (variantAllText[pr.variant.label] || '') + '\n── ' + pr.variant.label + ' ──\n' + pr.text;
    results.push(pr);
  }
  async function recognizeCanvas(variant, worker, canvas) {
    var dpi = prepDpiMap[variant.prep] || 300;
    /* DPI = 96×scale sudah benar — canvas sudah di-scale optimal via
       calculateOptimalScale; DPI lebih tinggi hanya menambah beban komputasi
       Tesseract tanpa menambah akurasi. Semua worker adalah model best. */
    var useDpi = dpi;
    try {
      var r = await worker.recognize(canvas, {
        tessedit_pageseg_mode: variant.psm,
        tessedit_ocr_engine_mode: variant.engine,
        tessedit_enable_doc_dict: '0',
        tessedit_char_whitelist: variant.whitelist,
        load_system_dawg: '0',
        load_freq_dawg: '0',
        tessedit_create_hocr: '0',
        tessedit_create_tsv: '0',
        tessedit_create_txt: '1',
        tessedit_create_box: '0',
        tessedit_create_unlv: '0',
        tessedit_create_osd: '0',
        user_defined_dpi: String(useDpi)
      }, { text: true, blocks: false, hocr: false, tsv: false, box: false, unlv: false, osd: false });
      return { variant: variant, text: r.data.text || '' };
    } catch(e) {
      return { variant: variant, text: '' };
    }
  }
  /* SMART AUTO-SCALE (PERCEPATAN): decode _blob HANYA SEKALI per climb (bukan tiap
     kandidat — hemat createImageBitmap berulang untuk blob besar), lalu bangun canvas
     kandidat per scale dengan crop yang SAMA dengan pass utama (mc → area manual;
     PHONE_CROP → strip kiri 50%; selain itu seluruh gambar), skala × scale, prep
     Invert. Scale di-clamp ×4.0 & pixel cap dilonggarkan ke 12MP agar canvas
     membesar BENERAN seperti auto-search demo (tanpa freeze dini di 5MP). */
  var _climbBmp = null;
  async function ensureClimbBmp() {
    if (_climbBmp) return _climbBmp;
    try { _climbBmp = await createImageBitmap(_blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); }
    catch(e) { _climbBmp = null; }
    return _climbBmp;
  }
  function buildClimbCanvasFromBmp(scale) {
    var img2 = _climbBmp;
    if (!img2) return null;
    /* Replikasi crop pass utama (lihat getPrep) — strip 50% ikut diperbesar, bukan
       gambar penuh, supaya auto-scale menaikkan zoom AREA yang sama dengan scan utama. */
    var mc2 = null;
    for (var mci2 = 0; mci2 < MANUAL_CROPS.length; mci2++) {
      var mce2 = MANUAL_CROPS[mci2];
      var mceTolH2 = (mce2.tolH != null) ? mce2.tolH : TOL_H;
      if (Math.abs(img2.width - mce2.srcW) <= TOL_W && Math.abs(img2.height - mce2.srcH) <= mceTolH2) { mc2 = mce2; break; }
    }
    var sx2 = 0, sy2 = 0, cw3 = img2.width, ch3 = img2.height;
    if (mc2) {
      var mcw3 = Math.min(mc2.cw, img2.width - mc2.cx);
      var mch3 = (mc2.cy === 0 && mc2.ch === mc2.srcH) ? img2.height : Math.min(mc2.ch, img2.height - mc2.cy);
      sx2 = mc2.cx; sy2 = mc2.cy; cw3 = mcw3; ch3 = mch3;
    } else if (!noPhone && PHONE_CROP && img2.width >= PHONE_CROP.minW &&
               !isBigOrTall(img2.width, img2.height)) {
      cw3 = Math.floor(img2.width * PHONE_CROP.ratio) + 1; /* strip kiri 50%, tinggi penuh — bukan sumber besar/tinggi */
    }
    /* Pixel cap climb DILONGGAARKAN 5MP → 12MP (sama seperti demo — canvas kandidat
       membesar BENERAN tiap step): 720×1600 (strip 361×1600) naik nyata sampai ×4.0,
       sumber besar/tinggi naik nyata sampai ±×2.1 — tanpa freeze dini yang membuat
       climb "berhenti memberi hasil" sebelum mencoba semua scale. */
    var _cap2 = Math.sqrt(12000000 / (cw3 * ch3));
    var _s2 = Math.min(scale, 4, _cap2);
    if (_s2 <= 0) return null;
    var _sw2 = Math.round(cw3 * _s2), _sh2 = Math.round(ch3 * _s2);
    var _PAD2 = 2;
    var _c2 = document.createElement('canvas');
    _c2.width = _sw2 + _PAD2 * 2; _c2.height = _sh2 + _PAD2 * 2;
    var _ctx2 = _c2.getContext('2d', { willReadFrequently: true });
    _ctx2.fillStyle = '#fff'; _ctx2.fillRect(0, 0, _c2.width, _c2.height);
    _ctx2.imageSmoothingEnabled = true; _ctx2.imageSmoothingQuality = 'high';
    _ctx2.drawImage(img2, sx2, sy2, cw3, ch3, _PAD2, _PAD2, _sw2, _sh2);
    var _id2 = _ctx2.getImageData(0, 0, _c2.width, _c2.height);
    invert(_id2); /* prep Invert — SEMUA jalur pakai Invert (instruksi user) */
    _ctx2.putImageData(_id2, 0, 0);
    _c2._effScale = _s2; /* scale efektif (setelah clamp pixel cap) — dipakai climb untuk skip duplikat */
    return _c2;
  }
  /* ---- Pass utama: PARALEL MULTI-SCALE BURST (4 Worker sekaligus) ---- */
  var _parallelDoneScales = {};
  var isTall = !isCrop && canvases[0] && canvases[0].height > CHUNK_HEIGHT;
  if (isTall) {
    /* Potret HP tinggi: irisan PSM 3 (auto-segmentasi, baca SEMUA blok) di-PARALELKAN
       di kedua worker (irisan i → worker i%2). PSM 6 pada irisan hanya membaca blok
       dominan → baris lain hilang ("tidak semua terOCR"). PSM 3 per irisan membaca
       SEMUA blok teks di irisan itu, dan irisan dipotong di baris kosong jadi tidak
       ada teks yang terbelah. Fallback full PSM 3 hanya bila irisan tidak menemukan
       kode sama sekali. */
    try {
      var nChunks = Math.max(2, Math.ceil(canvases[0].height / CHUNK_HEIGHT));
      var _chunks = splitCanvasV(canvases[0], nChunks);
      var _chunkJobs = [];
      for (var _cki = 0; _cki < _chunks.length; _cki++) {
        (function(_ck, _ci) {
          _chunkJobs.push(recognizeCanvas(VARIANTS[VARIANTS.length - 1], pw[_ci % pw.length] || pw[0], _ck).then(function(r) {
            _ck.width = 0; _ck.height = 0;
            r.quality = 1;
            return r;
          }));
        })(_chunks[_cki], _cki);
      }
      var _chunkRes = await Promise.all(_chunkJobs);
      for (var _cri = 0; _cri < _chunkRes.length; _cri++) {
        processResult(_chunkRes[_cri]);
      }
    } catch(e) {}
    /* Fallback: irisan tidak menemukan kode → full PSM 3 (varian terakhir aktif).
       HANYA jika masih ada varian berbeda yang bisa menambah (VARIANTS.length > 1) —
       dengan varian TUNGGAL (PSM 3 saja), irisan sudah mencakup seluruh canvas
       (dipotong di baris kosong), jadi full re-read = duplikat sia-sia. */
    if (Object.keys(allCodeMap).length === 0 && VARIANTS.length > 1) {
      try {
        var _fbr2 = await recognizeCanvas(VARIANTS[VARIANTS.length - 1], pw[1] || pw[0], canvases[0]);
        _fbr2.quality = 1;
        processResult(_fbr2);
      } catch(e) {}
    }
  } else if (isCrop || (opts && opts.noPrep) || pw.length < 2) {
    /* Crop manual / noPrep / single worker: scan langsung di worker */
    var mainPasses = [];
    for (var mvi = 0; mvi < VARIANTS.length; mvi++) {
      (function(mv) {
        mainPasses.push(recognizeCanvas(VARIANTS[mv], pw[mv] || pw[0], canvases[mv] || canvases[0]).then(function(r) {
          r.quality = isCrop ? 2 : 1;
          processResult(r);
        }));
      })(mvi);
    }
    await Promise.all(mainPasses);
  } else {
    /* ============================================================
       PARALEL PENUH — STRATEGI TERBAIK (4 Worker Serentak)
       ============================================================
       PRINSIP:
         canvases[0] sudah SIAP (crop, scale, invert, dilate) — tidak perlu
         decode ulang. Worker 0 & 1 langsung mulai 0ms setelah prep.
         Worker 2 & 3 pakai extra canvas kecil (cap 2MP) agar scan cepat.

       Worker 0 │ canvases[0] (siap, 0ms delay) │ PSM 6 → blok baris angka — paling akurat
       Worker 1 │ canvases[0] (siap, 0ms delay) │ PSM 3 → auto-layout — tangkap posisi bebas
       Worker 2 │ scale 2.5× (cap 2MP, kecil)   │ PSM 6 → zoom extra akurasi, canvas ringan
       Worker 3 │ scale 2.5× (cap 2MP, kecil)   │ PSM 3 → zoom extra, layout bebas, ringan
       ============================================================ */
    var parallelJobs = [];
    var _ps6 = { label: 'dil ps6', prep: 'dilated', psm: '6', whitelist: '0123456789+', engine: '1', dpi: 200 };
    var _ps3 = VARIANTS[0]; /* PSM 3 asli */

    /* Worker 0: PSM 6 pada canvases[0] yang sudah siap — langsung mulai, 0ms delay */
    parallelJobs.push(recognizeCanvas(_ps6, pw[0], canvases[0]).then(function(r) {
      r.quality = 2;
      return r;
    }).catch(function() { return null; }));

    /* Worker 1: PSM 3 pada canvases[0] yang sama — langsung mulai, 0ms delay */
    if (pw[1]) {
      parallelJobs.push(recognizeCanvas(_ps3, pw[1], canvases[0]).then(function(r) {
        r.quality = 1;
        return r;
      }).catch(function() { return null; }));
    }

    /* Worker 2 & 3: extra canvas zoom 2.5× dengan pixel cap kecil (2MP) agar ringan */
    if (pw[2] || pw[3]) {
      await ensureClimbBmp(); /* decode bitmap hanya bila ada worker extra tersedia */
      if (_climbBmp) {
        /* Bangun canvas extra kecil (2MP cap) — jauh lebih ringan dari 12MP */
        (function() {
          var img2 = _climbBmp;
          var cw3 = img2.width, ch3 = img2.height;
          if (!noPhone && PHONE_CROP && img2.width >= PHONE_CROP.minW && !isBigOrTall(img2.width, img2.height)) {
            cw3 = Math.floor(img2.width * PHONE_CROP.ratio) + 1;
          }
          var _capSmall = Math.sqrt(2000000 / (cw3 * ch3)); /* 2MP cap — cepat di CPU */
          var _sExtra = Math.min(2.5, _capSmall);
          if (_sExtra <= 0) return;
          var _sw2 = Math.round(cw3 * _sExtra), _sh2 = Math.round(ch3 * _sExtra);
          var _PAD2 = 2;
          var _cExtra = document.createElement('canvas');
          _cExtra.width = _sw2 + _PAD2 * 2; _cExtra.height = _sh2 + _PAD2 * 2;
          var _ctx2 = _cExtra.getContext('2d', { willReadFrequently: true });
          _ctx2.fillStyle = '#fff'; _ctx2.fillRect(0, 0, _cExtra.width, _cExtra.height);
          _ctx2.imageSmoothingEnabled = true; _ctx2.imageSmoothingQuality = 'high';
          _ctx2.drawImage(img2, 0, 0, cw3, ch3, _PAD2, _PAD2, _sw2, _sh2);
          var _id2 = _ctx2.getImageData(0, 0, _cExtra.width, _cExtra.height);
          invert(_id2);
          _ctx2.putImageData(_id2, 0, 0);
          _parallelDoneScales[_sExtra] = true;

          /* Worker 2: PSM 6 pada canvas extra kecil */
          if (pw[2]) {
            var _cExtra2 = _cExtra; /* referensi sama — canvas di-share, tidak di-mutate */
            parallelJobs.push(recognizeCanvas(_ps6, pw[2], _cExtra2).then(function(r) {
              r.quality = 2;
              return r;
            }).catch(function() { return null; }));
          }

          /* Worker 3: PSM 3 pada canvas extra kecil */
          if (pw[3]) {
            parallelJobs.push(recognizeCanvas(_ps3, pw[3], _cExtra).then(function(r) {
              /* Bersihkan canvas extra setelah semua scan selesai */
              _cExtra.width = 0; _cExtra.height = 0;
              r.quality = 2;
              return r;
            }).catch(function() {
              _cExtra.width = 0; _cExtra.height = 0;
              return null;
            }));
          }
        })();
      }
    }

    var parallelRes = await Promise.all(parallelJobs);
    for (var pri = 0; pri < parallelRes.length; pri++) {
      if (parallelRes[pri]) processResult(parallelRes[pri]);
    }
  }

  /* ESKALASI best: jika pass utama TIDAK menemukan kode sama sekali, jalankan
     ulang canvas penuh di worker kedua (akurasi maksimal, sudah best).
     HANYA saat VARIANTS.length > 1 — dengan varian TUNGGAL ini duplikat pass utama
     pada canvas yang sama (hasil pasti 0 lagi) → buang waktu di gambar sulit.
     Untuk potret tinggi tidak perlu — fallback full sudah jalan di atas. */
  if (!isCrop && !isTall && Object.keys(allCodeMap).length === 0 && pw.length >= 2 && canvases[0] && VARIANTS.length > 1) {
    try {
      /* PSM 3 — ulang baca seluruh canvas di worker kedua (varian terakhir aktif). */
      var _eb = recognizeCanvas(VARIANTS[VARIANTS.length - 1], pw[1], canvases[0]);
      var _ebr = await _eb;
      _ebr.quality = 2; /* eskalasi selalu model best */
      processResult(_ebr);
    } catch(e) {}
  }

  /* ---- SMART AUTO-SCALE (SEMUA gambar) ----
     Jalan bila bestcode ('+Ambil') belum ketemu — berburu bestcode lewat climb
     (instruksi user: climb tidak boleh jadi tidak berguna untuk cari bestcode).
     CEPAT (instruksi user terbaru: "auto scalenya biar lebih cepat"): FASE 1
     kasar langkah +0.5 dari SETTING "Perbesaran OCR" (default ×1.5, min ×1.0)
     sampai ×4.0 mencari skala skor terbaik, lalu FASE 2 refine +0.1 di sekitar
     pemenang (±0.4); berhenti SEGERA begitu bestcode terbaca. FAST-PATH kode
     tunggal (instruksi user terbaru): bila hanya ada PERSIS 1 kode tiket dan
     kode yang SAMA terbaca di ≥2 scan auto-scale → langsung berhenti & ambil
     kode itu saja (tidak ada +Ambil lain yang perlu dicari). Mentok di ×4.0
     (pixel cap climb dilonggarkan ke 12MP), paralel hingga 4 worker (percepatan maksimal). Setiap kandidat
     di-skala dari SUMBER dengan crop yang SAMA dengan pass utama (strip 50% +
     Invert), lalu hasilnya digabung; jika sampai mentok +Ambil tidak ketemu,
     pemenang di-scan ulang maksimal 2× paralel (konfirmasi — Tesseract non-deterministik)
     lalu seluruh hasil semua scale tetap ditampilkan — kandidat skor tertinggi
     otomatis menang di displayCodes (diurut count+quality, skor = kode ×
     bestcode × potongan digit, lihat scoreOcrText).
     Skip hanya saat noPrep (preview — blob sudah di-skala & di-prep di sisi
     preview, dan auto-search demo sudah menangani scale di sana). */
  var _climbInfo = null; /* diagnostik: berapa scale dicoba + skor tertinggi */
  if (!(opts && opts.noPrep)) {
    var _hasBest = false;
    for (var _bci = 0; _bci < results.length; _bci++) {
      var _bcl = (results[_bci].text || '').split('\n').filter(Boolean);
      var _bcc = extractCodes(results[_bci].text || '');
      if (getAllBestCodes(_bcl, _bcc, false).length) { _hasBest = true; break; }
    }
    /* FAST-EXIT PARALEL: Bila kode 19 digit sudah terkonfirmasi di ≥2 worker paralel
       dari scan awal serentak → kode sudah stabil & valid → lewati climb */
    var _allParallelStable = false;
    var _valid19Codes = Object.keys(allCodeMap).filter(function(k) { return k.length === 19; });
    if (_valid19Codes.length >= 1) {
      var _allConfirmed = true;
      for (var _vi = 0; _vi < _valid19Codes.length; _vi++) {
        if (allCodeMap[_valid19Codes[_vi]].count < 2) { _allConfirmed = false; break; }
      }
      if (_allConfirmed) _allParallelStable = true;
    }
    if (!_hasBest && !_allParallelStable) {
      /* CLIMB CEPAT — coarse-to-refine (instruksi user: "auto scalenya biar lebih
         cepat"). FASE 1 (kasar): langkah +0.5 dari SETTING "Perbesaran OCR"
         (default ×1.5, min ×1.0) sampai ×4.0 → cari skala skor teks terbaik.
         FASE 2 (refine): langkah +0.1 di sekitar pemenang kasar (±0.4) → skala
         halus tempat +Ambil paling mungkin terbaca. Berhenti SEGERA begitu
         bestcode ('+Ambil') terbaca di fase mana pun. FAST-PATH kode tunggal
         (instruksi user terbaru: "untuk yang kode tiket hanya 1, apabila 2x auto
         scale sudah sesuai kodenya berarti langsung ambil itu saja"): bila hanya
         ada PERSIS 1 kode tiket 19 digit dan kode yang SAMA terbaca di ≥2 scan
         auto-scale (2 skala berbeda — dedupe per scan), climb BERHENTI — kode
         sudah terkonfirmasi. Kalau scan awal membaca kode BEDA → lanjut climb
         normal (kode belum konsisten). Jumlah scan jauh lebih sedikit daripada
         naik +0.1 dari awal (≈14 vs ≈26) → auto-scale lebih cepat. Scale pass
         utama dilewati (sudah di-scan) agar tidak dobel. */
      var _mainScaleR = Math.round((procInfo.scale || 1.5) * 10) / 10;
      var _setR = Math.max(1.0, Math.min(Math.round((cropScale || 1.5) * 10) / 10, 4)); /* min ×1.0 (instruksi user) */
      var _start = _setR;
      var _triedSet = Object.assign({}, _parallelDoneScales || {});
      function _tryScale(s) {
        var r = Math.round(s * 10) / 10;
        if (r < 1.0 || r > 4.0001) return null;
        if (Math.abs(r - _mainScaleR) < 0.01) return null; /* skip duplikat pass utama */
        if (_triedSet[r]) return null;
        _triedSet[r] = true;
        return r;
      }
      var _asList = [];
      for (var _c0 = _start; _c0 <= 4.0001; _c0 = Math.round((_c0 + 0.5) * 10) / 10) {
        var _c1 = _tryScale(_c0);
        if (_c1 != null) _asList.push(_c1);
      }
      if (!_asList.length) _asList.push(4);
      await ensureClimbBmp();
      var _bestScore = -1, _bestScale = 0, _lastEff = [], _climbTried = 0, _climbFound = false;
      /* FAST-PATH kode tunggal (instruksi user terbaru): kode 19 digit yang SAMA
         di ≥2 scan auto-scale → berhenti. _climbCodes: kode → jumlah scan yang
         membacanya (dedupe per scan, jadi 2 = 2 skala berbeda). */
      var _singleConfirmed = false;
      var _climbCodes = {};
      /* Kandidat diproses dalam BATCH — sebanyak worker yang tersedia (kini 4)
         sekaligus (pw[0..3]) → wall-time terbagi ~4×. Hasil sama persis
         (akumulasi ke allCodeMap + deteksi bestcode per kandidat). */
      async function _runClimbList(list, maxStall) {
        /* EARLY-STOP (percepatan): bila skor tidak naik selama maxStall scan
           beruntun → puncak sudah lewat → hentikan fase ini & refine di sekitar
           skala terbaik. Skor naik kembali kapan pun → _stall direset, jadi
           puncak asli yang lebih jauh tetap ketahuan. */
        var _stall = 0;
        for (var _asi = 0; _asi < list.length && !_climbFound && !_singleConfirmed && !(maxStall && _stall >= maxStall); _asi += pw.length) {
          var _batch = [];
          for (var _pi2 = 0; _pi2 < pw.length && _asi + _pi2 < list.length; _pi2++) {
            var _asScale = list[_asi + _pi2];
            try {
              var _asc = buildClimbCanvasFromBmp(_asScale);
              if (!_asc) continue;
              /* Pixel cap membekukan beberapa scale ke canvas yang SAMA → scan
                 duplikat sia-sia. Skip bila scale efektif tidak berubah. */
              if (_asc._effScale && Math.abs(_asc._effScale - _lastEff[_pi2]) < 0.01) { _asc.width = 0; _asc.height = 0; continue; }
              _lastEff[_pi2] = _asc._effScale || _asScale;
              _batch.push({ scale: _asScale, canvas: _asc, wi: _pi2 });
            } catch(e) {}
          }
          if (!_batch.length) break;
          var _bres = await Promise.all(_batch.map(function(b) {
            return recognizeCanvas(VARIANTS[VARIANTS.length - 1], pw[b.wi % pw.length] || pw[0], b.canvas).then(function(r) {
              b.canvas.width = 0; b.canvas.height = 0;
              return { r: r, scale: b.scale };
            });
          }));
          for (var _bi = 0; _bi < _bres.length && !_climbFound && !_singleConfirmed; _bi++) {
            var _asr = _bres[_bi].r;
            _asr.quality = 2; /* auto-scale = model best (akurasi maksimal) */
            processResult(_asr);
            var _sc2 = scoreOcrText(_asr.text || '');
            if (_sc2 > _bestScore) { _bestScore = _sc2; _bestScale = _bres[_bi].scale; _stall = 0; }
            /* EARLY-STOP hanya menghitung skala yang TIDAK menaikkan skor SETELAH
               ada skala yang berhasil (skor > 0). Saat belum ada yang terbaca sama
               sekali (skor tetap 0), JANGAN pernah berhenti lebih awal — puncak
               belum tentu lewat: untuk gambar kecil/buram kode baru terbaca di
               skala TINGGI (3.5–4.0), dan stop dini di 1.5–3.0 membuat climb
               berhenti sebelum sampai ke sana (bug 263×600 — demo ketemu, engine
               tidak). Dengan syarat ini, gambar kosong tetap discan sampai ×4.0
               (maks 6 kandidat kasar, canvas kecil → cepat); gambar normal yang
               puncaknya sudah lewat tetap berhenti lebih awal. */
            else if (_bestScore > 0) _stall++;
            _climbTried++;
            var _asl = (_asr.text || '').split('\n').filter(Boolean);
            var _asc2 = extractCodes(_asr.text || '');
            if (getAllBestCodes(_asl, _asc2, false).length) { _climbFound = true; } /* bestcode ketemu → setop */
            /* Fast-path kode tunggal: hanya 1 kode 19 digit & SAMA di ≥2 scan
               auto-scale → berhenti & ambil kode itu saja (instruksi user). */
            var _u19 = {};
            for (var _ti = 0; _ti < _asc2.length; _ti++) if (_asc2[_ti].length === 19) _u19[_asc2[_ti]] = true;
            for (var _uk in _u19) _climbCodes[_uk] = (_climbCodes[_uk] || 0) + 1;
            var _soloN = 0, _soloK = null;
            for (var _sk in _climbCodes) { _soloN++; _soloK = _sk; }
            if (_soloN === 1 && _climbCodes[_soloK] >= 2) _singleConfirmed = true;
          }
        }
      }
      await _runClimbList(_asList, 2); /* FASE 1: kasar +0.5 — stop setelah 2 skala beruntun tidak menaikkan skor */
      if (!_climbFound && !_singleConfirmed && _bestScore > 0 && _bestScale > 0) {
        /* FASE 2: refine +0.1 di sekitar pemenang kasar (±0.4) — dilewati bila fase
           kasar TIDAK menemukan apa pun (skor 0): refine di sekitar skala skor-0
           tidak akan menolong, dan gambar yang butuh skala tinggi sudah discan
           penuh sampai ×4.0 oleh fase kasar (fix stall v3.40). */
        var _refList = [];
        for (var _rf = Math.round((_bestScale - 0.4) * 10) / 10; _rf <= _bestScale + 0.4001; _rf = Math.round((_rf + 0.1) * 10) / 10) {
          var _r1 = _tryScale(_rf);
          if (_r1 != null) _refList.push(_r1);
        }
        if (_refList.length) await _runClimbList(_refList, 3); /* FASE 2: refine +0.1 — stop setelah 3 scan beruntun tidak menaikkan skor */
      }
      /* KONFIRMASI (hanya jika bestcode belum ketemu & fast-path tidak berhenti)
         — Tesseract non-deterministik (hasil bisa beda antar scan gambar yang
         sama) → scan ulang canvas pemenang MAKSIMAL 2× secara PARALEL (2 sampel
         independen dari 2 worker berbeda — cukup menangkap +Ambil yang terlewat
         scan pertama, biaya cuma 1 batch bukan 3). */
      if (_bestScale > 0 && !_climbFound && !_singleConfirmed) {
        /* Konfirmasi PARALEL (percepatan maksimal): 2 scan bersamaan di 2 worker
           — satu batch. Tidak ada scan penutup ketiga. */
        function _cfScan(_w) {
          var _cfc = buildClimbCanvasFromBmp(_bestScale);
          if (!_cfc) return null;
          return recognizeCanvas(VARIANTS[VARIANTS.length - 1], _w, _cfc).then(function(_cfr) {
            _cfc.width = 0; _cfc.height = 0;
            _cfr.quality = 2; /* auto-scale = model best (akurasi maksimal) */
            processResult(_cfr);
            _climbTried++;
            var _cfl = (_cfr.text || '').split('\n').filter(Boolean);
            var _cfc2 = extractCodes(_cfr.text || '');
            if (getAllBestCodes(_cfl, _cfc2, false).length) _climbFound = true; /* bestcode ketemu di konfirmasi → setop */
            return _cfr;
          }).catch(function(e) { _cfc.width = 0; _cfc.height = 0; return null; });
        }
        var _cfP = [];
        var _cfA = _cfScan(pw[0]);
        if (_cfA) _cfP.push(_cfA);
        var _cfB = _cfScan(pw[1] || pw[0]);
        if (_cfB) _cfP.push(_cfB);
        if (_cfP.length) await Promise.all(_cfP);
      }
      if (_climbBmp) { try { _climbBmp.close(); } catch(e) {} _climbBmp = null; }
      _climbInfo = { tried: _climbTried, bestScale: _bestScale, bestScore: _bestScore, foundBest: _climbFound, singleConfirmed: _singleConfirmed };
    }
  }

  /* CATATAN: model standar TIDAK dipakai sebagai safety net lagi — standar
     sering tertukar digit (3↔5, 8↔0) yang justru merusak akurasi kode tiket.
     Semua jalur memakai model best (lib/best/). */

  for (var dci = 0; dci < canvases.length; dci++) {
    if (canvases[dci]) { canvases[dci].width = 0; canvases[dci].height = 0; }
  }
  canvases = null;

  var partialMap = {};
  results.forEach(function(pr) {
    var pLines = pr.text.split('\n');
    for (var pi = 0; pi < pLines.length; pi++) {
      var t1 = getTokens(pLines[pi]);
      for (var pa = 0; pa < t1.length; pa++) {
        if (t1[pa].length === 9 && t1[pa][0] === '2') {
          for (var pgap = 1; pgap <= 2 && pi + pgap < pLines.length; pgap++) {
            var canBridge = true;
            for (var pm = 1; pm < pgap; pm++) {
              var midT = getTokens(pLines[pi + pm]);
              for (var pt = 0; pt < midT.length; pt++) {
                if (midT[pt].length >= 9) { canBridge = false; break; }
              }
              if (!canBridge) break;
            }
            if (!canBridge) break;
            var t2 = getTokens(pLines[pi + pgap]);
            for (var pb = 0; pb < t2.length; pb++) {
              if (t2[pb].length === 9) {
                var partial = t1[pa] + t2[pb];
                if (!partialMap[partial]) partialMap[partial] = { count: 0, sources: [] };
                partialMap[partial].count++;
                if (partialMap[partial].sources.indexOf(pr.variant.label) === -1)
                  partialMap[partial].sources.push(pr.variant.label);
              }
            }
          }
        }
      }
    }
  });
  var codePrefixMap = {};
  Object.keys(allCodeMap).forEach(function(c19) {
    if (c19.length === 19) codePrefixMap[c19.substring(0, 18)] = c19;
  });
  Object.keys(partialMap).forEach(function(p18) {
    var c19 = codePrefixMap[p18];
    if (c19) {
      allCodeMap[c19].count += partialMap[p18].count;
      partialMap[p18].sources.forEach(function(s) {
        if (allCodeMap[c19].sources.indexOf(s) === -1) allCodeMap[c19].sources.push(s);
      });
    }
  });

  /* ---- Dedup kode kembar (tiket fisik SAMA terbaca 2 pass dengan beda kecil) ----
     Contoh user: pass utama baca '2083293626363048033' (digit 9→0), eskalasi
     (model best + zoom) baca '2083293626363948033' (BENAR). Keduanya tiket yang
     sama → tampilkan hanya yang quality tertinggi (2 = eskalasi/climb), buang yang lain.
     Edit distance ≤1 pada 19 digit = beda 1 karakter OCR — cukup mirip untuk dianggap
     kembar. Kode yang benar-benar berbeda (beda >1 digit) tetap dipertahankan. */
  function _editDist1(a, b) {
    var m = a.length, n = b.length;
    if (m === n) {
      var d = 0;
      for (var i = 0; i < m; i++) if (a[i] !== b[i]) d++;
      return d;
    }
    if (Math.abs(m - n) > 1) return 2;
    var minLen = Math.min(m, n);
    var d = Math.abs(m - n);
    for (var i = 0; i < minLen; i++) if (a[i] !== b[i]) d++;
    return d;
  }
  (function dedupTwinCodes() {
    var list = Object.keys(allCodeMap);
    var groups = {};
    // Grup berdasarkan 9 digit pertama (prefix kode tiket)
    list.forEach(function(c) {
      var pre = c.substring(0, 9);
      if (!groups[pre]) groups[pre] = [];
      groups[pre].push(c);
    });
    Object.keys(groups).forEach(function(pre) {
      var g = groups[pre];
      if (g.length < 2) return;
      // Pilih kode dengan quality tertinggi; buang kembaran ber-quality rendah
      var best = null;
      g.forEach(function(c) {
        if (!allCodeMap[c]) return;
        if (!best) { best = c; return; }
        if (_editDist1(c, best) <= 1) {
          var qc = allCodeMap[c].quality || 0;
          var qb = allCodeMap[best].quality || 0;
          /* Guard anti-false-merge: dua tiket BENAR-BENAR berbeda bisa share 9 digit
             awal (mis. 208329353 + 5465076736 dan 208329353 + 2101157888 di data
             user). Hanya anggap kembar jika quality berbeda (satu dari eskalasi/best)
             ATAU salah satunya sudah terkonfirmasi (count >= 2 dari sumber berbeda). */
          var confirmed = allCodeMap[c].count >= 2 || allCodeMap[best].count >= 2;
          if (qc === qb && !confirmed) return;
          if (qc > qb || (qc === qb && allCodeMap[c].count >= allCodeMap[best].count)) {
            allCodeMap[c].count += allCodeMap[best].count;
            delete allCodeMap[best];
            best = c;
          } else {
            allCodeMap[best].count += allCodeMap[c].count;
            delete allCodeMap[c];
          }
        }
      });
    });
  })();

  var allCodes = Object.keys(allCodeMap);
  var displayCodes = allCodes.slice().sort(function(a, b) {
    var aConfirmed = allCodeMap[a].count >= 2 ? 100 : 0;
    var bConfirmed = allCodeMap[b].count >= 2 ? 100 : 0;
    return (bConfirmed + allCodeMap[b].count) - (aConfirmed + allCodeMap[a].count);
  });

  var bestCodes = [];
  if (displayCodes.length > 0) {
    // Multi-pass (ps6/ps3/irisan) untuk +Ambil — proses SETIAP hasil OCR secara
    // terpisah (pass utama, chunk, eskalasi) agar baris + dari satu pass
    // TIDAK bisa menjangkau kode dari pass lain. Sebelumnya semua hasil digabung tanpa
    // separator sehingga "29965+" (eskalasi) menarik kode "208328747"+"7803767297"
    // dari pass utama → false best. (pola sama seperti popup.js)
    for (var pass = 0; pass < 2; pass++) {
      for (var bri = 0; bri < results.length; bri++) {
        var ps6Lines = (results[bri].text || '').split('\n').filter(Boolean);
        var ps6Best = getAllBestCodes(ps6Lines, allCodes, pass === 1);
        ps6Best.forEach(function(c) {
          if (c && allCodeMap[c] && allCodeMap[c].count >= 1 && bestCodes.indexOf(c) === -1) bestCodes.push(c);
        });
      }
    }
    var elapsed = ((Date.now() - _t0) / 1000).toFixed(1);
    // Return canvases to pool sebelum return
    try {
      if (prepCache) {
        Object.keys(prepCache).forEach(function(k) {
          var cv = prepCache[k];
          if (cv && cv.width) { cv.width = 0; cv.height = 0; if (!window._sharedCanvasPool) window._sharedCanvasPool = []; if (window._sharedCanvasPool.length < 6) window._sharedCanvasPool.push(cv); }
        });
        prepCache = {};
      }
    } catch(e) {}
    return {
      codes: displayCodes,
      codeInfo: allCodeMap,
      bestCodes: bestCodes,
      lines: allLines,
      passages: buildPassages(results, variantAllText),
      allRaw: allRaw,
      /* text = GABUNGAN teks mentah SEMUA pass (utama + eskalasi), dipisah
         separator '── label ──' (format splitPassBlocks) — sumber teks LENGKAP tanpa
         filter "hanya pass yang menemukan kode" (allRaw), agar konsumen seperti
         auto-search demo mendapat kredit parsial (potongan kode / bestcode). */
      text: Object.keys(variantAllText).map(function(k) { return variantAllText[k]; }).join('\n').trim(),
      elapsed: elapsed,
      rawTexts: results.map(function(r) { return r.text; }),
      engineVersion: OCR_ENGINE_VERSION,
      procInfo: procInfo,
      climbInfo: _climbInfo,
      error: '',
    };
  } else {
    return { codes: [], codeInfo: {}, bestCodes: [], lines: [], passages: [], allRaw: '', text: '', elapsed: '', rawTexts: [], climbInfo: null, error: '' };
  }
}

/* =====================================================================
 * OCR TEKS BEBAS (mode 'all' — NAMA/RRN)
 * ===================================================================== */
/* Dua varian PARALEL (pola asli): PSM 6 (blok tunggal) + PSM 3 (auto, baca
   semua blok). Model best untuk akurasi digit. */
var ALL_VARIANTS = [
  { label: 'all ps6', prep: 'dilated', psm: '6', whitelist: '', engine: '1', dpi: 200 },
  { label: 'all ps3', prep: 'dilated', psm: '3', whitelist: '', engine: '1', dpi: 200 },
];
var _bridgeWorkers = [];
var _bridgeWorkers2 = [];
var _bridgeScanCount = 0;
var _bridgeScanCount2 = 0;
var _bridgeLang = ''; /* langPath pool bridge (selalu lib/best/) */
var _bridgeLang2 = '';

function preprocessImageAll(blob) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      URL.revokeObjectURL(img.src);
      var scale = 2, maxDim = 4000;
      var w = img.naturalWidth, h = img.naturalHeight;
      if (w > h && w * scale > maxDim) scale = maxDim / w;
      else if (h * scale > maxDim) scale = maxDim / h;
      w = Math.round(w * scale); h = Math.round(h * scale);
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, w, h);
      var id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (var i = 0; i < id.data.length; i += 4) {
        var g = (0.299 * id.data[i] + 0.587 * id.data[i+1] + 0.114 * id.data[i+2]) | 0;
        id.data[i] = id.data[i+1] = id.data[i+2] = g;
      }
      var hist = new Int32Array(256), sum = 0, n = id.data.length / 4;
      for (var i = 0; i < id.data.length; i += 4) { hist[id.data[i]]++; sum += id.data[i]; }
      var mean = sum / n, total = n, sumB = 0, wB = 0, maxV = 0, threshold = mean > 128 ? mean * 0.85 : mean * 1.15;
      for (var t = 0; t < 256; t++) {
        wB += hist[t]; if (wB === 0) continue;
        var wF = total - wB; if (wF === 0) break;
        sumB += t * hist[t];
        var v = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) * ((sumB / wB) - ((sum - sumB) / wF));
        if (v > maxV) { maxV = v; threshold = t; }
      }
      if (threshold > 180) threshold = 180;
      for (var i = 0; i < id.data.length; i += 4) {
        var val = id.data[i] > threshold ? 255 : 0;
        id.data[i] = id.data[i+1] = id.data[i+2] = val;
      }
      sharpen(id);
      ctx.putImageData(id, 0, 0);
      resolve(canvas);
    };
    img.onerror = function() { URL.revokeObjectURL(img.src); resolve(blob); };
    img.src = URL.createObjectURL(blob);
  });
}

async function initBridgeWorkers(lang, pool) {
  pool = pool ? 1 : 0;
  var w = pool === 1 ? _bridgeWorkers2 : _bridgeWorkers;
  /* Guard konkuren per-pool (pola sama dengan initWorkers/initBestWorkers) — mencegah
     dua request NAMA/RRN dengan model berbeda saling terminate worker. */
  if (!window._initBridgePromise) window._initBridgePromise = {};
  if (window._initBridgePromise[pool]) return window._initBridgePromise[pool];
  window._initBridgePromise[pool] = (async function() {  /* Pool bridge dibangun SEKALI per model. Dua worker — satu per varian ps6/ps3 —
     agar pass utama berjalan PARALEL. Di-recycle tiap 30 scan. */
    /* Recycle dijalankan SEBELUM early-return agar counter terakumulasi di
       SETIAP scan (pola sama dengan initBestWorkers) — tanpa ini recycle tidak
       pernah aktif karena worker sudah hangat → memori LSTM menumpuk. */
    if (pool === 1) _bridgeScanCount2++; else _bridgeScanCount++;
    if ((pool === 1 ? _bridgeScanCount2 : _bridgeScanCount) >= 30) {
      try {
        for (var rci = 0; rci < w.length; rci++) { w[rci].terminate().catch(function() {}); }
      } catch(e) {}
      w.length = 0;
      if (pool === 1) _bridgeScanCount2 = 0; else _bridgeScanCount = 0;
    }
    var curLang = pool === 1 ? _bridgeLang2 : _bridgeLang;
    if (w.length >= 2 && curLang === (lang || '')) return;
    if (w.length >= 2) {
      try {
        for (var mci = 0; mci < w.length; mci++) { w[mci].terminate().catch(function() {}); }
      } catch(e) {}
      w.length = 0;
    }
    var needed = 2 - w.length;
    if (needed <= 0) return;
    var T = window.Tesseract;
    if (!T) { console.warn('ocr-engine: Tesseract not loaded'); return; }
    var base = chrome.runtime.getURL('lib/');
    var promises = [];
    for (var i = 0; i < needed; i++) {
      promises.push(createTessWorker(lang || base));
    }
    var newWorkers = await Promise.all(promises);
    for (var i = 0; i < newWorkers.length; i++) w.push(newWorkers[i]);
    if (pool === 1) _bridgeLang2 = lang || ''; else _bridgeLang = lang || '';
  })();
  try { return await window._initBridgePromise[pool]; }
  finally { delete window._initBridgePromise[pool]; }
}

function dataUrlToBlob(dataUrl) {
  return new Promise(function(resolve) {
    if (dataUrl.indexOf('data:') !== 0) { resolve(null); return; }
    var parts = dataUrl.split(',');
    if (parts.length !== 2) { resolve(null); return; }
    var mimeMatch = parts[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : 'image/png';
    var raw = atob(parts[1]);
    var rawLen = raw.length;
    var u8arr = new Uint8Array(rawLen);
    for (var i = 0; i < rawLen; i++) u8arr[i] = raw.charCodeAt(i);
    resolve(new Blob([u8arr], { type: mime }));
  });
}

/* ---- OCR teks bebas (pure, mengembalikan {text, allRaw, lines, elapsed, error}) ---- */
async function processAllText(url, opts) {
  var t0 = Date.now();
  /* Kebijakan SIMD per scan: override eksplisit (dikirim SW) menang atas baca storage sendiri */
  _simdAllowOverride = (opts && typeof opts.allowNoSimd === 'boolean') ? opts.allowNoSimd : null;
  var isCrop = !!(opts && opts.noAutoCrop);
  /* zoom maks area crop: override eksplisit MENANG; selain itu baca setting storage.
     Clamp GARDU TERAKHIR min ×1.0 (instruksi user) — sama dengan jalur scan utama. */
  var cropScale = (opts && opts.cropScale) ? opts.cropScale : (await getCropScaleSetting()).value;
  cropScale = Math.max(1.0, Math.min(parseFloat(cropScale) || 1.5, 4));
  /* Round-robin pool bridge (0/1) — dua scan NAMA/RRN LiveChat bersamaan memakai
     worker terpisah sehingga berjalan PARALEL, bukan mengantre di 2 worker sama. */
  var _pool = (opts && opts.pool) ? 1 : 0;
  var bw = _pool === 1 ? _bridgeWorkers2 : _bridgeWorkers;
  var _base2 = chrome.runtime.getURL('lib/');
  /* NAMA/RRN: semua jalur memakai model best (lib/best/) — akurasi maksimal. */
  var _lang = _base2 + 'best/';
  try {
    var _blob;
    if (url.indexOf('data:') === 0) {
      _blob = await dataUrlToBlob(url);
      if (!_blob) throw new Error('Gagal konversi data URL');
    } else {
      var resp = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(10000) });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      _blob = await resp.blob();
    }

    var img;
    try {
      img = await createImageBitmap(_blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    } catch(e) {
      var prepped = await preprocessImageAll(_blob);
      await initBridgeWorkers(_lang, _pool);
      if (!bw.length || !bw[0]) throw new Error('Worker not available');
      var rawResult = await bw[0].recognize(prepped, {
        tessedit_pageseg_mode: '6', tessedit_ocr_engine_mode: '1', tessedit_enable_doc_dict: '0'
      });
      var rawText = rawResult.data.text || '';
      var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      var cleaned = rawText.replace(/[^a-zA-Z0-9.,'"]/g, ' ').replace(/\s+/g, ' ').trim();
      return { text: cleaned, allRaw: rawText, lines: cleaned.split('\n').filter(Boolean), elapsed: elapsed, error: '' };
    }

    var calc = calculateOptimalScale(img.width, img.height);
    var scale = calc.scale;
    /* SUMBER BESAR/TINGGI tanpa crop: cap 12MP (sama dengan jalur scan kode tiket)
       — 1280×2772 full discan ×1.50 (1920×4158), bukan dipatok 5MP (×1.19). */
    var maxPixels = isBigOrTall(img.width, img.height) ? 12000000 : 5000000;
    var maxScalePixels = Math.sqrt(maxPixels / (img.width * img.height));
    if (isCrop) {
      scale = Math.min(cropScale, maxScalePixels);
    } else if (scale > maxScalePixels) {
      scale = maxScalePixels;
    }

    var sw = Math.round(img.width * scale);
    var sh = Math.round(img.height * scale);      var PAD = 2; /* padding 2px di semua sisi (border putih) — dipilih user (sebelumnya 0, sekarang dikembalikan) */
    var canvas = document.createElement('canvas');
    canvas.width = sw + PAD * 2;
    canvas.height = sh + PAD * 2;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    var origW = img.width, origH = img.height;
    ctx.drawImage(img, PAD, PAD, sw, sh);
    img.close();

    var id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    removeSpecks(id);
    adaptiveDilate(id, origW, origH);
    enhanceContrast(id, 0.01);
    sharpen(id);
    ctx.putImageData(id, 0, 0);

    await initBridgeWorkers(_lang, _pool);
    if (!bw.length) throw new Error('Worker not available');

    var canvases = [canvas];
    var results = [];

    /* ---- Pass utama (pola asli): kedua varian PARALEL di 2 worker ---- */
    function _runVariant(idx, worker, cv) {
      var v = ALL_VARIANTS[idx];
      /* DPI = 96×scale — canvas sudah optimal, DPI lebih tinggi hanya menambah
         beban komputasi tanpa menambah akurasi. */
      var useDpi = Math.round(96 * scale);
      return worker.recognize(cv, {
        tessedit_pageseg_mode: v.psm, tessedit_ocr_engine_mode: v.engine,
        tessedit_enable_doc_dict: '0', load_system_dawg: '0', load_freq_dawg: '0',
        user_defined_dpi: String(useDpi)
      }).then(function(r) { return { variant: v, text: r.data.text || '' }; });
    }
    var isTall = canvas.height > CHUNK_HEIGHT;
    if (isTall) {
      /* Potret tinggi: irisan PSM 3 (baca SEMUA blok per irisan) di-PARALELKAN
         di kedua worker (irisan i → worker i%2). PSM 6 pada irisan hanya membaca
         blok dominan → baris lain hilang ("tidak semua terOCR"). Fallback full
         PSM 3 hanya bila ada irisan yang kosong. */
      try {
        var nChunksAll = Math.max(2, Math.ceil(canvas.height / CHUNK_HEIGHT));
        var _chunksAll = splitCanvasV(canvas, nChunksAll);
        var _chunkAllJobs = [];
        for (var _cai = 0; _cai < _chunksAll.length; _cai++) {
          (function(_ca, _ci2) {
            var _w2 = bw[_ci2 % bw.length] || bw[0];
            _chunkAllJobs.push(_w2.recognize(_ca, {
              tessedit_pageseg_mode: ALL_VARIANTS[1].psm, tessedit_ocr_engine_mode: ALL_VARIANTS[1].engine,
              tessedit_enable_doc_dict: '0', load_system_dawg: '0', load_freq_dawg: '0',
              user_defined_dpi: String(Math.round(96 * scale))
            }).then(function(r) {
              _ca.width = 0; _ca.height = 0;
              return { variant: ALL_VARIANTS[1], text: r.data.text || '' };
            }).catch(function() {
              /* Satu irisan gagal jangan merusak irisan lain (Promise.all fail-fast) */
              _ca.width = 0; _ca.height = 0;
              return { variant: ALL_VARIANTS[1], text: '' };
            }));
          })(_chunksAll[_cai], _cai);
        }
        var _settledChunksAll = await Promise.all(_chunkAllJobs);
        for (var _sai = 0; _sai < _settledChunksAll.length; _sai++) results.push(_settledChunksAll[_sai]);
      } catch(e) {}
      /* Fallback: ADA irisan yang kosong → full PSM 3 (safety net multi-block). */
      var _anyEmpty = false;
      for (var _tli = 0; _tli < results.length; _tli++) {
        if (!(results[_tli].text || '').trim()) { _anyEmpty = true; break; }
      }
      if (_anyEmpty) {
        try { results.push(await _runVariant(1, bw[1] || bw[0], canvas)); } catch(e) {}
      }
    } else {
      var allPasses = [];
      for (var avi = 0; avi < ALL_VARIANTS.length; avi++) {
        allPasses.push(_runVariant(avi, bw[avi] || bw[0], canvases[0]));
      }
      var settledAll = await Promise.all(allPasses);
      for (var ai = 0; ai < settledAll.length; ai++) results.push(settledAll[ai]);
    }

    canvas.width = 0; canvas.height = 0;

    var allRaw = '';
    /* GABUNGKAN SEMUA chunk (sebelumnya hanya teks chunk TERPANJANG — isi chunk
       lain HILANG → "tidak semua terOCR" untuk NAMA/RRN potret tinggi). */
    var mergedLines = [];
    var _seenLines = {};
    for (var ri = 0; ri < results.length; ri++) {
      var t = (results[ri].text || '').trim();
      if (t) {
        var clines = t.split('\n');
        for (var cli = 0; cli < clines.length; cli++) {
          var cline = clines[cli].trim();
          if (!cline) continue;
          /* Dedup baris yang sama persis di batas overlap antar chunk / antar varian
             (varian ps6 & ps3 membaca canvas yang sama → baris dobel tidak boleh masuk).
             Set penuh (bukan hanya 4 baris terakhir) — full pass + chunk membaca area
             yang sama sehingga duplikat bisa berjauhan di hasil gabungan. */
          if (_seenLines[cline]) continue;
          _seenLines[cline] = true;
          mergedLines.push(cline);
        }
      }
      allRaw += '\n── ' + results[ri].variant.label + ' ──\n' + results[ri].text;
    }

    var mergedText = mergedLines.join('\n');

    var cleaned = mergedText.replace(/[^a-zA-Z0-9.,'"]/g, ' ').replace(/\s+/g, ' ').trim();
    var elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    return { text: cleaned, allRaw: allRaw, lines: cleaned.split('\n').filter(Boolean), elapsed: elapsed, error: '' };

  } catch(err) {
    return { text: '', allRaw: '', lines: [], elapsed: '', error: err.message || 'Gagal OCR' };
  }
}

export function initOcrEngine() {
  return {
    VARIANTS: VARIANTS,
    detectFromImage: detectFromImage,
    processAllText: processAllText,
    initWorkers: initWorkers,
    initBestWorkers: initBestWorkers,
    warmWorkers: warmWorkers,
    dataUrlToBlob: dataUrlToBlob,
    ensureReady: function() {
      /* Pre-warm pool best 0 & 1 (semua jalur + round-robin LiveChat 2 gambar
         paralel). Pool standar TIDAK di-warm — hanya fallback bila model best
         gagal dimuat (4 worker LSTM best sudah cukup berat). */
      try { if (window.Tesseract) { initBestWorkers(0); initBestWorkers(1); } } catch(e) {}
    }
  };
}
