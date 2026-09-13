/* =====================================================================
 * OCR PIPELINE PREVIEW — lihat potongan & setiap tahap preprocessing
 *
 * Fungsi preprocessing & aturan crop di bawah ini adalah SALINAN PERSIS
 * dari modules/ocr-common.js dan modules/ocr-engine.js (getPrep) agar
 * apa yang Anda lihat = apa yang benar-benar dikirim ke Tesseract.
 * Jika fungsi di ocr-common/ocr-engine diubah, salinan di sini HARUS
 * ikut diubah agar preview tetap jujur.
 * ===================================================================== */
/* Engine di-import STATIS (pola sama dashboard/popup/offscreen) — menghindari
   dynamic import() yang rapuh di halaman extension MV3. Tesseract sendiri dimuat
   statis via <script src="../lib/tesseract.min.js"> di ocr-preview.html. */
import { initOcrEngine } from '../modules/ocr-engine.js';
import { getTokens, extractCodes, getAllBestCodes } from '../modules/ocr-common.js';
'use strict';

var $ = function(id) { return document.getElementById(id); };

/* ---- Guard akses: halaman preview hanya untuk email resmi ----
   Email yang diizinkan: 'fibiogenio121@gmail.com' (harus SINKRON dengan
   ALLOWED_EMAIL di pages/dashboard.js — tombol & halaman sama-sama diblokir).
   Pengguna lain melihat layar blokir, konten pipeline tidak pernah dieksekusi.
   Race-safe: email kosong (login belum selesai) tidak langsung diblokir —
   guard menunggu perubahan storage userEmail dan menilai ulang. */
var OCR_PREVIEW_ALLOWED_EMAIL = 'fibiogenio121@gmail.com';
(function guardOcrPreviewAccess() {
  if (!isExtension()) return; /* demo (tanpa chrome.runtime) tidak diblokir */
  var locked = false;
  function lock() {
    if (locked) return;
    locked = true;
    document.body.innerHTML = '';
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#94a3b8;font-family:Arial,sans-serif;';
    box.innerHTML = '<div style="text-align:center;"><div style="font-size:40px;margin-bottom:12px;">🔒</div>' +
      '<div style="font-size:16px;font-weight:600;color:#e2e8f0;margin-bottom:6px;">OCR Preview Terkunci</div>' +
      '<div style="font-size:12px;">Halaman ini hanya tersedia untuk akun yang diizinkan.</div></div>';
    document.body.appendChild(box);
  }
  function check() {
    if (locked) return;
    chrome.storage.local.get('userEmail', function(r) {
      if (locked) return;
      var email = String((r && r.userEmail) || '').toLowerCase().trim();
      if (!email) return; /* belum login / login sedang berjalan — tunggu onChanged */
      if (email !== OCR_PREVIEW_ALLOWED_EMAIL) lock();
    });
  }
  check();
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && changes.userEmail) check();
  });
})();

var stagesEl = $('stages'), infoEl = $('info'), emptyEl = $('empty');
var currentBlob = null, currentName = '';
var _lastManualCrop = null;   /* crop manual yang SEDANG dipakai render saat ini (null = auto) */
var _storedManualCrop = null; /* crop manual terakhir yang dipilih user — untuk tombol terapkan ulang */
var _storedCropDims = null;   /* dimensi (w×h) gambar asli saat _storedManualCrop dibuat */
/* Canvas AREA CROP (tahap 2) — inilah yang harus di-OCR oleh Tesseract asli,
   sesuai pilihan crop (auto atau manual). Di-set di processBlob. */
var _ocrCropCanvas = null;
var _ocrFinalCanvas = null; /* canvas FINAL (skala + preprocessing panel) yang dikirim ke OCR asli — di-set di processBlob */
var _ocrCropLabel = ''; /* label area yang sedang di-OCR (manual / auto / seluruh gambar) */
var _ocrIsCrop = false; /* true jika area aktif = crop user/override (cap skala OCR di engine) */
var _lastCropRule = null;  /* aturan crop aktif (dengan flag isPhone/isOverride) — untuk zoom eksplisit OCR asli */
var _lastSrcDims = null;   /* dimensi sumber asli (w×h) saat _lastCropRule dibuat */
var _autoScaleOverride = null; /* scale pemenang auto-search (null = aturan biasa) — dipakai processBlob */
var _autoBusy = false;         /* cegah double-run auto-search */
var _autoCancel = false;       /* user klik "Jalankan OCR" saat auto-search jalan → batalkan pencarian */
var _autoWinnerMeta = null;    /* {scale, keys} pemenang auto — dipakai renderOcrResult untuk label hasil akhir */

/* Zoom maksimal area crop ("Perbesaran OCR") — disimpan di chrome.storage.local
   'ocrCropScale' (default 1.5). Engine produksi membaca nilai yang SAMA di setiap
   scan, jadi preview = livechat/dashboard. */
var _cropScale = 1.5;

/* Peringatan visual bila nilai Perbesaran OCR TIDAK tersimpan ke storage.
   Kegagalan diam-diam (tab basi / dibuka di luar extension) membuat livechat
   selalu pakai fallback 1.5× — persis gejala src:fallback yang terdiagnosis. */
function setScaleWarn(msg) {
  /* Tampilkan di dua tempat: dalam modal (saat user mengubah zoom) DAN di header
     (selalu terlihat — peringatan saat load/mode demo tidak boleh tersembunyi).
     textContent dipakai → tulis & biasa, bukan &amp; (entitas tidak didecode). */
  ['cropScaleWarn', 'cropScaleWarnTop'].forEach(function(id) {
    var el = $(id);
    if (!el) return;
    if (msg) { el.textContent = msg; el.style.display = 'inline'; }
    else el.style.display = 'none';
  });
}

function loadCropScale() {
  return new Promise(function(resolve) {
    var done = function() {
      var inp = $('cropScaleInput');
      if (inp) inp.value = _cropScale.toFixed(2);
      resolve(_cropScale);
    };
    try {
      if (isExtension() && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('ocrCropScale', function(r) {
          if (chrome.runtime && chrome.runtime.lastError) {
            /* Baca gagal → storage tidak bisa diakses dari tab ini → simpan juga gagal */
            setScaleWarn('⚠️ Konteks extension hilang — setting tidak tersimpan. Tutup & buka ulang tab OCR Preview.');
            done();
            return;
          }
          var v = parseFloat(r && r.ocrCropScale);
          /* min ×1.0 (instruksi user) — sinkron dengan engine */
          if (!isNaN(v) && v >= 1.0 && v <= 4) _cropScale = v;
          done();
        });
      } else {
        /* Mode demo (dibuka di luar extension): nilai hanya berlaku di halaman ini */
        setScaleWarn('ℹ️ Mode demo — setting tidak disimpan ke extension. Buka dari panel extension agar livechat ikut nilai ini.');
        done();
      }
    } catch(e) {
      setScaleWarn('⚠️ Konteks extension hilang — setting tidak tersimpan. Tutup & buka ulang tab OCR Preview.');
      done();
    }
  });
}

function saveCropScale() {
  setScaleWarn('');
  /* Tangkap nilai yang DITULIS di closure — read-back membandingkan dengan nilai ini,
     bukan _cropScale live, supaya ketikan cepat ("1", "1.", "1.5") tidak memicu
     false warning dari read-back yang saling tumpang tindih. */
  var written = _cropScale;
  try {
    if (isExtension() && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ ocrCropScale: written }, function() {
        /* Verifikasi read-back — menangkap set yang gagal diam-diam (tab basi) */
        if (chrome.runtime && chrome.runtime.lastError) {
          setScaleWarn('⚠️ Setting TIDAK tersimpan (konteks hilang). Tutup & buka ulang tab OCR Preview.');
          return;
        }
        chrome.storage.local.get('ocrCropScale', function(r) {
          var v = parseFloat(r && r.ocrCropScale);
          var ok = !isNaN(v) && Math.abs(v - written) < 0.001;
          if (!ok) {
            setScaleWarn('⚠️ Setting TIDAK tersimpan (storage kosong/basi). Tutup & buka ulang tab OCR Preview, lalu set ulang zoom.');
          }
        });
      });
    } else {
      setScaleWarn('ℹ️ Mode demo — setting tidak disimpan ke extension. Buka dari panel extension agar livechat ikut nilai ini.');
    }
  } catch(e) {
    setScaleWarn('⚠️ Setting TIDAK tersimpan. Tab basi? Tutup & buka ulang tab OCR Preview.');
  }
}

/* Jaga _cropScale SELALU sinkron dengan storage — kalau 'ocrCropScale' berubah di tab
   preview lain / saat extension reload, tab ini ikut TANPA menunggu OCR ulang.
   Sebelumnya snapshot saat tab dibuka bisa basi → zoom preview ≠ zoom livechat
   (persis kasus 1.10× vs 1.50× pada canvas yang sama). */
try {
  if (isExtension() && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area !== 'local' || !changes.ocrCropScale) return;
      var v = parseFloat(changes.ocrCropScale.newValue);
      if (isNaN(v) || v < 1.0 || v > 4 || v === _cropScale) return;
      _cropScale = v;
      var inp = $('cropScaleInput');
      if (inp) inp.value = _cropScale.toFixed(2);
      /* Skip re-render saat editor crop terbuka — seleksi user tidak boleh hilang;
         pipeline ikut sinkron otomatis saat editor ditutup (closeCropEditor). */
      var modal = $('cropModal');
      if (currentBlob && !_inProcessBlob && (!modal || modal.classList.contains('hidden'))) {
        processBlob(currentBlob, currentName, _lastManualCrop, true);
      }
    });
  }
} catch(e) {}

/* Zoom potret HP (PHONE_CROP) — mengikuti setting 'ocrCropScale' (Perbesaran OCR,
   _cropScale) yang SAMA dengan engine produksi (livechat/dashboard) — sinkron dengan
   modules/ocr-engine.js getPrep: potret HP NORMAL pakai cropScale setting; potret BESAR
   (lebar ≥ 1000 DAN tinggi ≥ 2000, mis. 1440×3200) pakai ×1 — teks sudah
   besar, tanpa upscale. Harus SINKRON dengan PHONE_CROP di modules/ocr-engine.js. */
var PHONE_CROP_BIG = { minW: 1000, minH: 2000, scale: 1 };
var TALL_MIN_H = 1700; /* harus SINKRON dengan TALL_MIN_H di modules/ocr-engine.js */
function isBigOrTall(w, h) {
  return (w >= PHONE_CROP_BIG.minW && h >= PHONE_CROP_BIG.minH) || h > TALL_MIN_H;
}
function cropScaleFor(crop, srcW, srcH) {
  /* Zoom DIPATOK per-resolusi (crop.scale — mis. 450×800 → ×2.4) menang atas setting
     global — harus SINKRON dengan mc.scale di MANUAL_CROPS modules/ocr-engine.js. */
  if (crop && crop.scale) return crop.scale;
  if (crop && crop.isPhone &&
      srcW >= PHONE_CROP_BIG.minW && srcH >= PHONE_CROP_BIG.minH) return PHONE_CROP_BIG.scale;
  return _cropScale;
}

/* ---- Panel pilihan preprocessing (UJI COBA) ----
   Default SEMUA MATI di panel — produksi kini prep Invert (instruksi user: SEMUA aturan
   memakai Invert). Nyalakan per
   tahap untuk menguji efeknya pada gambar kecil/buram: pipeline tahap 4–15 tetap
   DIHITUNG dan hasil "Jalankan OCR" ikut berubah (canvas tahap TERAKHIR = yang
   dikirim ke Tesseract). Tampilan kartu ringkas (PREVIEW_MINIMAL=true): hanya
   Gambar Asli & HASIL AKHIR yang ditampilkan. Murni alat uji preview — TIDAK
   menyentuh aturan produksi (prep: ['invert']) di livechat/dashboard. */
var preprocOpts = {
  upscale: false, specks: false, median: false, dilate: false, erode: false,
  contrast: false, clahe: false, gamma: false, otsu: false, adaptive: false,
  invert: false, sharpen: false
};
/* Urutan = urutan pipeline (tahap 4-15): Upscale 2× DULUAN (perbesar teks kecil
   sebelum filter lain), lalu filter; Sharpen paling akhir sebagai penutup. */
var PREPROC_KEYS = ['upscale', 'specks', 'median', 'dilate', 'erode', 'contrast',
  'clahe', 'gamma', 'otsu', 'adaptive', 'invert', 'sharpen'];
var PREPROC_LABEL = {
  upscale: 'Upscale 2×', specks: 'Buang Spek', median: 'Median', dilate: 'Dilasi Adaptif',
  erode: 'Erosi', contrast: 'Kontras', clahe: 'CLAHE', gamma: 'Gamma',
  otsu: 'Binarisasi Otsu', adaptive: 'Binarisasi Adaptif', invert: 'Invert', sharpen: 'Sharpen'
};

/* Tampilan pipeline MINIMAL: hanya kartu tahap 1 (Gambar Asli) & HASIL AKHIR yang
   ditampilkan. Tahap tengah (crop, skala, preprocessing 4-15) tetap DIHITUNG dan
   tetap memengaruhi canvas yang dikirim ke Tesseract — hanya kartunya yang
   disembunyikan supaya preview ringkas (instruksi user). Set false untuk
   menampilkan semua tahap lagi. */
var PREVIEW_MINIMAL = true;

function applyPreprocToggle(key, on) {
  preprocOpts[key] = !!on;
  var btn = $('pp' + key.charAt(0).toUpperCase() + key.slice(1));
  if (btn) { btn.classList.toggle('on', !!on); btn.classList.toggle('off', !on); }
}

function setAllPreproc(on) {
  PREPROC_KEYS.forEach(function(k) { applyPreprocToggle(k, on); });
}

function preprocSummary() {
  return PREPROC_KEYS.map(function(k) {
    return (preprocOpts[k] ? '✓' : '✗') + ' ' + PREPROC_LABEL[k];
  }).join(' · ');
}

function preprocApplied() {
  return PREPROC_KEYS.filter(function(k) { return preprocOpts[k]; }).map(function(k) { return PREPROC_LABEL[k]; });
}

/* =====================================================================
 * 1) SALINAN PERSIS preprocessing (modules/ocr-common.js)
 * ===================================================================== */

/* ---- Penghapus noise spek (salt-and-pepper) ---- */
function removeSpecks(imageData, maxArea) {
  if (maxArea === undefined) maxArea = 8;
  var d = imageData.data;
  var w = imageData.width, h = imageData.height;
  var total = w * h;
  var visited = new Uint8Array(total);
  var stack = [];
  var TH = 128;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = y * w + x;
      if (visited[i] || d[i * 4] >= TH) continue;
      var area = 0;
      var pts = [];
      stack.length = 0;
      stack.push(i);
      visited[i] = 1;
      while (stack.length) {
        var ci = stack.pop();
        var cx = ci % w;
        area++;
        if (area <= maxArea) pts.push(ci);
        if (cx > 0 && !visited[ci - 1] && d[(ci - 1) * 4] < TH) { visited[ci - 1] = 1; stack.push(ci - 1); }
        if (cx < w - 1 && !visited[ci + 1] && d[(ci + 1) * 4] < TH) { visited[ci + 1] = 1; stack.push(ci + 1); }
        if (ci >= w && !visited[ci - w] && d[(ci - w) * 4] < TH) { visited[ci - w] = 1; stack.push(ci - w); }
        if (ci < total - w && !visited[ci + w] && d[(ci + w) * 4] < TH) { visited[ci + w] = 1; stack.push(ci + w); }
      }
      if (area <= maxArea) {
        for (var p = 0; p < pts.length; p++) {
          var pi = pts[p] * 4;
          d[pi] = d[pi + 1] = d[pi + 2] = 255;
        }
      }
    }
  }
}

/* ---- Grayscale dilation ---- */
function dilateGray(imageData, radius) {
  if (radius === undefined) radius = 1;
  var d = imageData.data;
  var w = imageData.width;
  var h = imageData.height;
  var copy = new Uint8ClampedArray(d);
  for (var y = radius; y < h - radius; y++) {
    for (var x = radius; x < w - radius; x++) {
      var minVal = 255;
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dx = -radius; dx <= radius; dx++) {
          var val = copy[((y + dy) * w + (x + dx)) * 4];
          if (val < minVal) minVal = val;
        }
      }
      var i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = minVal;
    }
  }
}

/* ---- Dilasi adaptif (skip untuk gambar kecil / kontras sudah bagus) ---- */
function adaptiveDilate(imageData, srcW, srcH) {
  if (Math.max(srcW, srcH) <= 1400) return; // gambar kecil: tanpa dilasi
  var d = imageData.data;
  var len = d.length;
  var minV = 255, maxV = 0;
  for (var i = 0; i < len; i += 4) {
    var v = d[i];
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (maxV - minV >= 200) return; // kontras sudah bagus → skip
  dilateGray(imageData, 1);
}

/* ---- Adaptive contrast enhancement (histogram clip) ---- */
function enhanceContrast(imageData, clipPercent) {
  if (clipPercent === undefined) clipPercent = 0.02;
  var d = imageData.data;
  var len = d.length;
  var n = len / 4;
  for (var i = 0; i < len; i += 4) {
    var g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  var hist = new Int32Array(256);
  for (var i = 0; i < len; i += 4) { hist[d[i]]++; }
  var total = n;
  var clipLow = Math.round(total * clipPercent);
  var clipHigh = Math.round(total * (1 - clipPercent));
  var cum = 0;
  var minVal = 0, maxVal = 255;
  for (var i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= clipLow) { minVal = i; break; }
  }
  cum = 0;
  for (var i = 255; i >= 0; i--) {
    cum += hist[i];
    if (cum >= total - clipHigh) { maxVal = i; break; }
  }
  var range = maxVal - minVal;
  if (range < 20) return;
  if (range >= 200) return; // kontras sudah optimal
  var scale = 255 / range;
  for (var i = 0; i < len; i += 4) {
    var v = (d[i] - minVal) * scale;
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    d[i] = d[i + 1] = d[i + 2] = Math.round(v);
  }
}

/* ---- Sharpen ---- */
function sharpen(imageData) {
  var d = imageData.data;
  var w = imageData.width;
  var h = imageData.height;
  var len = w * h;
  var gray = new Uint8Array(len);
  for (var i = 0; i < len; i++) gray[i] = d[i * 4];
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var gi = y * w + x;
      var v = (-gray[gi - w] - gray[gi - 1] - gray[gi + 1] - gray[gi + w] + 5 * gray[gi]);
      var di = gi * 4;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[di] = d[di + 1] = d[di + 2] = v;
    }
  }
}

/* =====================================================================
 * 1b) PREPROCESSING TAMBAHAN — KHUSUS PANEL UJI COBA (tidak ada di produksi)
 * Fungsi di bawah ini BUKAN salinan ocr-common.js — murni alat uji demo untuk
 * mencari kombinasi preprocessing terbaik pada gambar kecil/buram. Semua mutasi
 * ImageData in-place, KECUALI upscale2xCanvas (ukuran canvas berubah).
 * ===================================================================== */

/* ---- Median filter 3×3 — hilangkan noise butiran (lebih kuat dari buang spek) ---- */
function medianFilter(imageData, radius) {
  if (radius === undefined) radius = 1;
  var d = imageData.data;
  var w = imageData.width, h = imageData.height;
  var copy = new Uint8ClampedArray(d);
  var win = new Uint8Array((radius * 2 + 1) * (radius * 2 + 1));
  var k = 0;
  for (var y = radius; y < h - radius; y++) {
    for (var x = radius; x < w - radius; x++) {
      k = 0;
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dx = -radius; dx <= radius; dx++) {
          win[k++] = copy[((y + dy) * w + (x + dx)) * 4];
        }
      }
      win.sort(); /* Uint8Array.prototype.sort — ascending numeric */
      var med = win[Math.floor(k / 2)];
      var i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = med;
    }
  }
}

/* ---- Erosi grayscale (max filter) — menipiskan teks tebal / buang titik noise ---- */
function erodeGray(imageData, radius) {
  if (radius === undefined) radius = 1;
  var d = imageData.data;
  var w = imageData.width, h = imageData.height;
  var copy = new Uint8ClampedArray(d);
  for (var y = radius; y < h - radius; y++) {
    for (var x = radius; x < w - radius; x++) {
      var maxVal = 0;
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dx = -radius; dx <= radius; dx++) {
          var val = copy[((y + dy) * w + (x + dx)) * 4];
          if (val > maxVal) maxVal = val;
        }
      }
      var i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = maxVal;
    }
  }
}

/* ---- Binarisasi Otsu (global) — ambang otomatis optimal, hasil hitam-putih ---- */
function otsuThreshold(imageData) {
  var d = imageData.data;
  var len = d.length;
  var total = len / 4;
  /* Grayscale in-place DULU supaya histogram & ambang konsisten (R=G=B),
     bukan histogram-luminance vs bandingkan kanal merah. */
  for (var i = 0; i < len; i += 4) {
    var g0 = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = d[i + 1] = d[i + 2] = g0;
  }
  var hist = new Int32Array(256);
  for (var i = 0; i < len; i += 4) {
    hist[d[i]]++;
  }
  var sum = 0;
  for (var i = 0; i < 256; i++) sum += i * hist[i];
  var sumB = 0, wB = 0, maxVar = -1, th = 127;
  for (var i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    var wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    var mB = sumB / wB;
    var mF = (sum - sumB) / wF;
    var between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; th = i; }
  }
  for (var i = 0; i < len; i += 4) {
    var v = d[i] < th ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

/* ---- Binarisasi adaptif (mean per blok, integral image) — tahan cahaya tidak merata ---- */
function adaptiveThreshold(imageData, blockSize, bias) {
  if (blockSize === undefined) blockSize = 16;
  if (bias === undefined) bias = 0.9;
  var d = imageData.data;
  var w = imageData.width, h = imageData.height;
  var n = w * h;
  var gray = new Uint8Array(n);
  for (var i = 0; i < n; i++) {
    var i4 = i * 4;
    gray[i] = (0.299 * d[i4] + 0.587 * d[i4 + 1] + 0.114 * d[i4 + 2]) | 0;
  }
  var W1 = w + 1;
  var intImg = new Float64Array((w + 1) * (h + 1));
  for (var y = 0; y < h; y++) {
    var rowSum = 0;
    var base = y * w;
    for (var x = 0; x < w; x++) {
      rowSum += gray[base + x];
      intImg[(y + 1) * W1 + (x + 1)] = intImg[y * W1 + (x + 1)] + rowSum;
    }
  }
  var half = blockSize >> 1;
  for (var y = 0; y < h; y++) {
    var y0 = y - half < 0 ? 0 : y - half;
    var y1 = y + half + 1 > h ? h : y + half + 1;
    var row0 = y0 * W1, row1 = y1 * W1;
    for (var x = 0; x < w; x++) {
      var x0 = x - half < 0 ? 0 : x - half;
      var x1 = x + half + 1 > w ? w : x + half + 1;
      var count = (y1 - y0) * (x1 - x0);
      var mean = (intImg[row1 + x1] - intImg[row1 + x0] - intImg[row0 + x1] + intImg[row0 + x0]) / count;
      var i4 = (y * w + x) * 4;
      var v = gray[y * w + x] < mean * bias ? 0 : 255;
      d[i4] = d[i4 + 1] = d[i4 + 2] = v;
    }
  }
}

/* ---- CLAHE — equalisasi histogram adaptif kontras-terbatas (tiles 8×8) ---- */
function clahe(imageData, tiles, clipLimit) {
  if (tiles === undefined) tiles = 8;
  if (clipLimit === undefined) clipLimit = 2;
  var d = imageData.data;
  var w = imageData.width, h = imageData.height;
  var n = w * h;
  var gray = new Uint8Array(n);
  for (var i = 0; i < n; i++) gray[i] = d[i * 4];
  var tW = Math.max(1, Math.floor(w / tiles));
  var tH = Math.max(1, Math.floor(h / tiles));
  var cols = Math.ceil(w / tW), rows = Math.ceil(h / tH);
  var clip = Math.max(1, Math.round(clipLimit * tW * tH / 256));
  var maps = [];
  for (var ty = 0; ty < rows; ty++) {
    var rowMaps = [];
    var y0 = ty * tH, y1 = Math.min(y0 + tH, h);
    for (var tx = 0; tx < cols; tx++) {
      var x0 = tx * tW, x1 = Math.min(x0 + tW, w);
      var hist = new Int32Array(256);
      for (var yy = y0; yy < y1; yy++) {
        var rb = yy * w;
        for (var xx = x0; xx < x1; xx++) hist[gray[rb + xx]]++;
      }
      var excess = 0;
      for (var b = 0; b < 256; b++) {
        if (hist[b] > clip) { excess += hist[b] - clip; hist[b] = clip; }
      }
      var addEach = Math.floor(excess / 256), rem = excess % 256;
      for (var b = 0; b < 256; b++) hist[b] += addEach + (b < rem ? 1 : 0);
      var area = (y1 - y0) * (x1 - x0);
      var cdf = new Int32Array(256);
      var cum = 0;
      for (var b = 0; b < 256; b++) { cum += hist[b]; cdf[b] = Math.round(255 * cum / area); }
      rowMaps.push(cdf);
    }
    maps.push(rowMaps);
  }
  var out = new Uint8Array(n);
  for (var y = 0; y < h; y++) {
    var fy = y / tH - 0.5;
    var ty0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
    var ty1 = Math.max(0, Math.min(rows - 1, ty0 + 1));
    var wy = ty0 === ty1 ? 0 : fy - Math.floor(fy);
    for (var x = 0; x < w; x++) {
      var fx = x / tW - 0.5;
      var tx0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
      var tx1 = Math.max(0, Math.min(cols - 1, tx0 + 1));
      var wx = tx0 === tx1 ? 0 : fx - Math.floor(fx);
      var g = gray[y * w + x];
      var v00 = maps[ty0][tx0][g], v01 = maps[ty0][tx1][g];
      var v10 = maps[ty1][tx0][g], v11 = maps[ty1][tx1][g];
      out[y * w + x] = Math.round(
        v00 * (1 - wx) * (1 - wy) + v01 * wx * (1 - wy) +
        v10 * (1 - wx) * wy + v11 * wx * wy);
    }
  }
  for (var i = 0; i < n; i++) {
    var o = out[i];
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = o;
  }
}

/* ---- Gamma correction — cerahkan gambar terlalu gelap ---- */
function gammaCorrect(imageData, gamma) {
  if (gamma === undefined) gamma = 1.2;
  var d = imageData.data;
  var len = d.length;
  var inv = 1 / gamma;
  var lut = new Uint8Array(256);
  for (var i = 0; i < 256; i++) lut[i] = Math.min(255, Math.round(Math.pow(i / 255, inv) * 255));
  for (var i = 0; i < len; i += 4) {
    var g = lut[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
}

/* ---- Invert — teks putih di latar gelap jadi hitam ---- */
function invert(imageData) {
  var d = imageData.data;
  var len = d.length;
  for (var i = 0; i < len; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
}

/* ---- Upscale 2× — perbesar teks kecil (canvas BARU, padding dipertahankan) ---- */
function upscale2xCanvas(scaled, PAD, sw2, sh2) {
  var ns = document.createElement('canvas');
  ns.width = sw2 * 2 + PAD * 2;
  ns.height = sh2 * 2 + PAD * 2;
  var nctx = ns.getContext('2d', { willReadFrequently: true });
  nctx.fillStyle = '#fff';
  nctx.fillRect(0, 0, ns.width, ns.height);
  nctx.imageSmoothingEnabled = true;
  nctx.imageSmoothingQuality = 'high';
  nctx.drawImage(scaled, PAD, PAD, sw2, sh2, PAD, PAD, sw2 * 2, sh2 * 2);
  return ns;
}

/* ---- Hitung scale optimal (salinan persis calculateOptimalScale) ---- */
function calculateOptimalScale(w, h) {
  var maxDim = Math.max(w, h);
  var minDim = Math.min(w, h);
  var aspectRatio = maxDim / minDim;
  var isLandscape = w > h;
  var isIOSLike = (h > w && aspectRatio > 1.4 && maxDim > 1500) ||
                  (w > h && aspectRatio > 1.4 && maxDim > 1500);
  var targetSize = isIOSLike ? 1600 : 1400;
  var maxScale = 4.0;
  var scale = Math.min(targetSize / maxDim, maxScale);
  if (isLandscape && maxDim >= 1900 && minDim >= 1000) {
    scale = Math.max(scale, 2.0);
  }
  else if (scale < 1.0) {
    if (maxDim > 3000 && scale < 1.5) {
      scale = 1.5;
    } else if (maxDim > 2200) {
      if (scale < 1.5) scale = 1.5;
    } else if (maxDim > 1400) {
      scale = Math.max(scale, 1.5);
      if (maxDim <= 1700) scale = Math.max(scale, 2.0);
    } else {
      scale = Math.max(scale, 1.0);
    }
  } else {
    if (minDim < 300) {
      var altScale = Math.min(500 / minDim, maxScale);
      if (altScale > scale) scale = altScale;
      if (scale < 1.8) scale = 1.8;
    } else if (maxDim < 800) {
      if (scale < 3.0) scale = 3.0;
    } else if (maxDim < 1200) {
      if (scale < 2.0) scale = 2.0;
    } else if (maxDim < 2000) {
      if (maxDim <= 1600) {
        if (scale < 2.5) scale = 2.5;
      } else {
        if (scale < 2.0) scale = 2.0;
      }
    } else {
      if (scale < 1.5) scale = 1.5;
    }
  }
  if (maxDim > 1400 && scale > 1.5) scale = 1.5;
  var maxPixels = 5000000;
  var pixelCap = Math.sqrt(maxPixels / (w * h));
  if (scale > pixelCap) scale = pixelCap;
  return { scale: scale, dpi: Math.round(96 * scale), isIOSLike: isIOSLike };
}

/* =====================================================================
 * 2) ATURAN AUTO-CROP (salinan persis getPrep di ocr-engine.js)
 * ===================================================================== */
function applyAutoCrop(w, h) {
  /* OVERRIDE CROP MANUAL — harus SINKRON dengan MANUAL_CROPS di modules/ocr-engine.js.
     Instruksi user TERBARU: SEMUA gambar strip kiri 50% + Invert, KECUALI kecil
     (< 600 — FULL gambar + Invert + auto-scale, disamakan semua), desktop
     (1920×1080 / 1920×794) & sumber BESAR/TINGGI (isBigOrTall — lebar ≥ 1000 &
     tinggi ≥ 2000, ATAU tinggi > 1700, mis. 828×1792 — instruksi user "tinggi
     diatas 1700 berarti ikut tanpa crop seperti gambar besar lainnya"). Daftar di
     bawah berisi entry override (area kustom + zoom dipatok). Gambar kecil TIDAK
     punya entry → crop null → seluruh gambar + skala otomatis (calculateOptimalScale)
     + smart auto-scale. Resolusi lain jatuh ke strip kiri 50% (fallback PHONE_CROP). */
  var TOL_W = 4, TOL_H = 6; /* harus SINKRON dengan TOL_W/TOL_H di modules/ocr-engine.js */
  function near(ew, eh, tolH) { return Math.abs(w - ew) <= TOL_W && Math.abs(h - eh) <= (tolH != null ? tolH : TOL_H); }
  if (near(1920, 1080)) {
    return { cx: 693, cy: 231, cw: 237, ch: 560, isOverride: true, scale: 2.6, prep: ['invert'],
      label: 'Landscape 1920×1080 → crop MANUAL x693,y231 · 237×560 (override user)',
      desc: 'override crop manual dari OCR Preview — bukan center 600×1080 lagi, zoom dipatok ×2.6, prep Invert' };
  }
  if (near(1920, 794)) {
    /* 1920×794 KHUSUS — landscape WIDE, area x737,y0 · 451×794 (23% gambar),
       zoom ×2.0 + prep Invert (instruksi user terbaru); kotak tetap */
    return { cx: 737, cy: 0, cw: 451, ch: 794, isOverride: true, scale: 2.0, prep: ['invert'],
      label: 'Landscape 1920×794 → crop MANUAL x737,y0 · 451×794 (override user)',
      desc: 'override crop manual — 1920×794, area 23% (x737,y0 · 451×794), zoom dipatok ×2.0, prep Invert' };
  }
  if (near(1080, 2400)) {
    /* 1080×2400 KHUSUS — POTRET HP PORTRAIT, SELURUH gambar (x0,y0 · 1080×2400) dengan
       zoom DEFAULT DIPATOK ×2.30 + prep Invert (instruksi user terbaru). maxPixels
       dilonggarkan (14MP) agar ×2.30 tidak ter-cap — harus SINKRON dengan entry di
       modules/ocr-engine.js (MANUAL_CROPS). */
    return { cx: 0, cy: 0, cw: 1080, ch: 2400, isOverride: true, scale: 2.3, prep: ['invert'],
      maxPixels: 14000000,
      label: 'Potret 1080×2400 → SELURUH gambar · 1080×2400 (override user)',
      desc: 'override full gambar — zoom default dipatok ×2.30 (14MP cap), prep Invert' };
  }
  /* CROP STRIP KIRI 50% — harus SINKRON dengan PHONE_CROP di modules/ocr-engine.js.
     Instruksi user TERBARU: SEMUA gambar, kecuali kecil (< 600), desktop (entry di
     atas) & sumber BESAR/TINGGI (isBigOrTall — lebar ≥ 1000 & tinggi ≥ 2000, ATAU
     tinggi > 1700, "gambar ukuran besar jangan di crop" / "tinggi diatas 1700 ikut
     tanpa crop") → strip KIRI 50%. */
  if (w >= 600 && !isBigOrTall(w, h)) {
    var pcw = Math.floor(w * 0.5) + 1;
    return { cx: 0, cy: 0, cw: pcw, ch: h, isPhone: true, prep: ['invert'],
      label: 'Gambar → crop KIRI 50% · ' + pcw + '×' + h,
      desc: 'strip kiri (kode tiket + user ID) — x0,y0 · ' + pcw + '×' + h + ', prep Invert' };
  }
  return null;
}

/* =====================================================================
 * 3) RENDER PIPELINE — bangun semua tahap dari blob gambar
 * ===================================================================== */
function bitmapFromBlob(blob) {
  return new Promise(function(resolve, reject) {
    if (window.createImageBitmap) {
      createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
        .then(resolve).catch(function() { imgFallback(); });
    } else imgFallback();
    function imgFallback() {
      var img = new Image();
      img.onload = function() { URL.revokeObjectURL(img.src); resolve(img); };
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    }
  });
}

function addStage(num, title, desc, note, srcCanvas, clickFn) {
  var card = document.createElement('div');
  card.className = 'stage-card';
  card.innerHTML =
    '<div class="stage-head"><div class="stage-num">' + num + '</div>' +
    '<div class="stage-title">' + title + '</div>' +
    '<div class="stage-desc">' + desc + '</div></div>' +
    '<div class="stage-canvas-wrap"></div>' +
    '<div class="stage-foot"><span class="badge">' + desc + '</span><span>' + (note || '') + '</span></div>';
  var wrap = card.querySelector('.stage-canvas-wrap');
  var cv = document.createElement('canvas');
  cv.width = srcCanvas.width; cv.height = srcCanvas.height;
  cv.getContext('2d').drawImage(srcCanvas, 0, 0);
  cv.title = title + ' — klik untuk zoom';
  wrap.appendChild(cv);
  cv.addEventListener('click', clickFn || function() { openLightbox(cv, title + ' · ' + desc); });
  stagesEl.appendChild(card);
  return cv;
}

/* Overlay area crop di tahap "Gambar Asli" — mengikuti checkbox "Tampilkan area crop".
   Area di luar potongan digelapkan, potongan digaris kuning + label dimensi,
   sehingga terlihat persis DI MANA potongan itu diambil dari screenshot asli. */
var _stage1Canvas = null;
var _overlayState = null;
function renderStage1() {
  if (!_overlayState || !_stage1Canvas) return;
  var orig = _overlayState.orig;
  var ctx = _stage1Canvas.getContext('2d');
  _stage1Canvas.width = orig.width; _stage1Canvas.height = orig.height;
  ctx.drawImage(orig, 0, 0);
  var crop = _overlayState.crop;
  if (!($('chkOverlay') && $('chkOverlay').checked) || !crop) return;
  var w = _stage1Canvas.width, h = _stage1Canvas.height;
  ctx.fillStyle = 'rgba(129,140,248,0.18)';
  ctx.fillRect(0, 0, crop.cx, h);
  ctx.fillRect(crop.cx + crop.cw, 0, w - crop.cx - crop.cw, h);
  ctx.fillRect(crop.cx, 0, crop.cw, crop.cy);
  ctx.fillRect(crop.cx, crop.cy + crop.ch, crop.cw, h - crop.cy - crop.ch);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.strokeRect(crop.cx, crop.cy, crop.cw, crop.ch);
  var label = crop.cw + '×' + crop.ch;
  ctx.font = 'bold 16px Consolas, monospace';
  var tw = ctx.measureText(label).width;
  var lx = Math.min(Math.max(crop.cx + crop.cw / 2 - tw / 2, 4), w - tw - 8);
  var ly = Math.max(crop.cy - 8, 22);
  ctx.fillStyle = 'rgba(8,11,20,0.85)';
  ctx.fillRect(lx - 6, ly - 15, tw + 12, 21);
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1;
  ctx.strokeRect(lx - 6, ly - 15, tw + 12, 21);
  ctx.fillStyle = '#f59e0b';
  ctx.fillText(label, lx, ly);
}

function renderInfo(items) {
  infoEl.innerHTML = '';
  items.forEach(function(it) {
    var d = document.createElement('div');
    d.className = 'info-item' + (it.wide ? ' wide' : '');
    d.innerHTML = '<b>' + it.k + '</b><span>' + it.v + '</span>';
    infoEl.appendChild(d);
  });
}

/* =====================================================================
 * 3.5) KALKULATOR UKURAN OCR — ukuran yang seharusnya diproses Tesseract
 * Hitung area crop, skala optimal, dan canvas akhir (PAD 2) PERSIS seperti
 * pipeline produksi (getPrep + calculateOptimalScale).
 * ===================================================================== */
/* Hitung info persiapan OCR (satu-satunya sumber kebenaran):
   skala optimal + pixel cap + isCrop cap 1.5 + DPI + PAD 2.
   Dipakai oleh kalkulator ukuran, pipeline, DAN editor crop agar
   readout modal tidak pernah melenceng dari yang dikirim ke Tesseract. */
function computePrepInfo(cw, ch, isCrop, cropScale, maxPixelBudget) {
  var calc = calculateOptimalScale(cw, ch);
  var scale = calc.scale;
  /* SUMBER BESAR/TINGGI tanpa crop: cap 12MP (sama dengan climb & auto-search
     demo) — 1280×2772 full discan ×1.50 (1920×4158), bukan dipatok 5MP (×1.19).
     Entry override (mis. 1080×2400 ×2.30 → 13.7MP) boleh melonggarkan cap-nya
     sendiri (maxPixelBudget, SINKRON dengan entry maxPixels di ocr-engine). */
  var mp = maxPixelBudget || (isBigOrTall(cw, ch) ? 12000000 : 5000000);
  var maxScalePixels = Math.sqrt(mp / (cw * ch));
  /* Crop (isCrop di produksi): pakai zoom PERSIS setting user ('ocrCropScale', default 1.5)
     — bukan auto-calculateOptimalScale — agar preview = produksi (tunduk pixel cap 5MP). */
  if (isCrop) {
    var cap = (cropScale > 0) ? cropScale : 1.5;
    scale = Math.min(cap, maxScalePixels);
  } else if (scale > maxScalePixels) {
    scale = maxScalePixels;
  }
  var dpi = Math.round(96 * scale);
  var PAD = 2; /* padding 2px di semua sisi (border putih) — dipilih user (sebelumnya 0, dikembalikan) */
  var sw2 = Math.round(cw * scale);
  var sh2 = Math.round(ch * scale);
  return { scale: scale, dpi: dpi, sw2: sw2, sh2: sh2, finalW: sw2 + PAD * 2, finalH: sh2 + PAD * 2 };
}

function computeSizeGuide(w, h) {
  var crop = applyAutoCrop(w, h);
  var cw = crop ? crop.cw : w;
  var ch = crop ? crop.ch : h;
  /* Area override / potret HP = perilaku crop user (cap Perbesaran OCR) — konsisten dengan livechat */
  var prep = computePrepInfo(cw, ch, !!(crop && (crop.isOverride || crop.isPhone)), cropScaleFor(crop, w, h), crop && crop.maxPixels);
  var pct = Math.round((cw * ch) / (w * h) * 100);
  return {
    w: w, h: h, crop: crop, cw: cw, ch: ch,
    scale: prep.scale, dpi: prep.dpi, sw2: prep.sw2, sh2: prep.sh2,
    finalW: prep.finalW, finalH: prep.finalH, pct: pct
  };
}

function renderSizeGuide() {
  var w = parseInt($('szW').value, 10) || 0;
  var h = parseInt($('szH').value, 10) || 0;
  if (w < 1 || h < 1) {
    $('szResult').innerHTML = '<div class="sz-note warn">Masukkan lebar &amp; tinggi yang valid untuk melihat ukuran OCR yang seharusnya.</div>';
    document.querySelectorAll('#sizePanel .sz-presets button').forEach(function(b) { b.classList.remove('active'); });
    return;
  }
  var g = computeSizeGuide(w, h);
  var cells = [
    { k: 'Resolusi sumber', v: g.w + '×' + g.h },
    { k: 'Aturan crop', v: g.crop ? g.crop.label : 'Tidak ada' },
    { k: 'Area potongan', v: g.crop ? ('x' + g.crop.cx + ', y' + g.crop.cy + ' · ' + g.cw + '×' + g.ch) : 'Seluruh gambar' },
    { k: '% area diproses', v: g.pct + '% dari sumber' },
    { k: 'Skala optimal', v: '×' + g.scale.toFixed(2) + ' · ' + g.dpi + ' dpi' },
    { k: 'Ukuran skala', v: g.sw2 + '×' + g.sh2 },
    { k: 'Canvas → Tesseract', v: g.finalW + '×' + g.finalH + ' (padding 2 px)' }
  ];
  var html = '<div class="sz-grid">';
  cells.forEach(function(c) {
    html += '<div class="sz-cell"><b>' + c.k + '</b><span>' + c.v + '</span></div>';
  });
  html += '</div>';
  var note, cls;
  if (g.crop) {
    cls = 'ok';
    note = '✅ ' + g.crop.label + '. Hanya ' + g.pct + '% area yang dikirim ke Tesseract — lebih cepat &amp; akurat.';
  } else {
    cls = 'warn';
    note = '⚠️ Gambar ' + g.w + '×' + g.h + ' tidak di-crop (kecil &lt; 600 atau sumber besar ≥1000×2000) → SELURUH gambar diproses OCR + smart auto-scale. Gambar lain (lebar ≥ 600) otomatis di-crop strip kiri 50%.';
  }
  html += '<div class="sz-note ' + cls + '">' + note + '</div>';
  html += '<div class="sz-guide">Aturan yang berlaku di pipeline:<br>' +
    '• Desktop: <code>1920×1080</code> → potongan <b>manual x693,y231 · 237×560</b> (override user — zoom <b>dipatok ×2.60</b>, prep <b>Invert</b>)<br>' +
    '• Desktop: <code>1920×794</code> → potongan <b>manual x737,y0 · 451×794</b> (override user — zoom <b>dipatok ×2.00</b>, prep <b>Invert</b>)<br>' +
    '• Ukuran kecil (<code>lebar &lt; 600</code> — SEMUA, mis. 540×960, 344×605, 450×800, 225×393, 225×402) → <b>tidak dipotong</b> — SELURUH gambar + prep <b>Invert</b> + skala otomatis + smart auto-scale (aturan <b>disamakan</b>, tanpa zoom dipatok)<br>' +
    '• Sumber BESAR (<code>lebar ≥ 1000</code> &amp; <code>tinggi ≥ 2000</code>, mis. <code>1280×2772</code>) → <b>TIDAK dipotong</b> — seluruh gambar diproses, zoom <b>×1.50</b> (cap 12MP — persis pemenang demo: 1920×4158), prep <b>Invert</b><br>' +
    '• Gambar TINGGI (<code>tinggi &gt; 1700</code> — termasuk <code>828×1792</code>) → <b>TIDAK dipotong</b> — seluruh gambar diproses seperti sumber besar, prep <b>Invert</b><br>' +
    '• SEMUA gambar lain (<code>lebar ≥ 600</code>, potret maupun non-potret, tanpa entry di atas) → potongan <b>kiri 50% × tinggi penuh</b> (kode tiket + user ID + bestcode) — zoom <b>×' + _cropScale.toFixed(2) + '</b>, prep <b>Invert</b><br>' +
    '• SMART AUTO-SCALE: bila pass utama belum menemukan bestcode (<b>+Ambil</b>), zoom <b>naik otomatis (+0.1)</b> mulai dari setting Perbesaran OCR (min <b>×1.0</b>) sampai bestcode terbaca — mentok <b>×4.0</b>; jika tidak ketemu, hasil <b>skor tertinggi</b> yang ditampilkan<br>' +
    'SEMUA aturan memakai prep <b>Invert</b> (instruksi terbaru). Sesuaikan resolusi tangkapan agar masuk aturan yang Anda inginkan.</div>';
  $('szResult').innerHTML = html;
  document.querySelectorAll('#sizePanel .sz-presets button').forEach(function(b) {
    b.classList.toggle('active', b.dataset.w === String(w) && b.dataset.h === String(h));
  });
}

/* Tampilkan tombol "Terapkan crop terakhir" hanya jika ada crop manual tersimpan
   dari gambar sebelumnya yang berukuran SAMA dan masih muat di gambar baru. */
function updateReuseCropBtn(sw, sh, usingManual) {
  var btn = $('btnReuseCrop');
  if (!btn) return;
  var mc = _storedManualCrop;
  var ok = !usingManual && mc && _storedCropDims &&
    _storedCropDims.w === sw && _storedCropDims.h === sh &&
    mc.cx + mc.cw <= sw && mc.cy + mc.ch <= sh;
  btn.classList.toggle('hidden', !ok);
  if (ok) btn.textContent = '🔁 Crop terakhir (' + mc.cw + '×' + mc.ch + ')';
}

async function processBlob(blob, name, manualCrop, keepCalc) {
  /* Gambar baru / render ulang → tutup editor crop yang mungkin masih terbuka,
     supaya modal tidak menampilkan gambar + seleksi lama (basi). */
  _inProcessBlob = true;
  try {
    closeCropEditor();
  /* Gambar BARU (bukan re-render toggle/crop) → reset scale pemenang auto-search */
  if (!keepCalc) _autoScaleOverride = null;
  var bmp = await bitmapFromBlob(blob);
  var sw = bmp.width, sh = bmp.height;
  var orig = document.createElement('canvas');
  orig.width = sw; orig.height = sh;
  orig.getContext('2d').drawImage(bmp, 0, 0);
  if (bmp.close) { try { bmp.close(); } catch (e) {} }

  /* Sinkronkan kalkulator ukuran dengan gambar yang dimuat (kecuali re-render
     preprocessing — biarkan nilai custom yang diketik user tetap ada) */
  if (!keepCalc) {
    $('szW').value = sw;
    $('szH').value = sh;
    renderSizeGuide();
  }

  currentBlob = blob;
  currentName = name || 'gambar';
  _lastManualCrop = manualCrop || null;
  /* Gambar baru → hasil pemenang auto-search basi, sembunyikan area gambarnya */
  var _awr = $('autoResultWrap');
  if (_awr) _awr.style.display = 'none';
  _autoWinnerMeta = null;
  if (manualCrop) { _storedManualCrop = manualCrop; _storedCropDims = { w: sw, h: sh }; }
  updateReuseCropBtn(sw, sh, !!manualCrop);
  emptyEl.style.display = 'none';
  stagesEl.innerHTML = '';
  stagesEl.classList.remove('hidden');
  infoEl.classList.remove('hidden');

  /* --- Tahap 1: asli + overlay area crop (klik gambar untuk atur area OCR) --- */
  var crop = manualCrop
    ? { cx: manualCrop.cx, cy: manualCrop.cy, cw: manualCrop.cw, ch: manualCrop.ch,
        label: 'Crop MANUAL (pilihan Anda)',
        desc: 'x=' + manualCrop.cx + ', y=' + manualCrop.cy + ' · ' + manualCrop.cw + '×' + manualCrop.ch }
    : applyAutoCrop(sw, sh);
  /* Area override / potret HP = perilaku crop manual (cap Perbesaran OCR) — persis livechat */
  var cropIsUserArea = !!manualCrop || !!(crop && (crop.isOverride || crop.isPhone));
  _ocrIsCrop = cropIsUserArea;
  /* Simpan aturan + dimensi sumber — dipakai runOcr untuk mengirim zoom eksplisit
     (kalkulator) ke engine, termasuk aturan potret BESAR ×1. */
  _lastCropRule = crop;
  _lastSrcDims = { w: sw, h: sh };
  /* Aturan crop bisa membawa resep preprocessing (mis. gambar kecil →
     ['upscale','sharpen']) — sinkronkan ke panel agar pipeline preview jujur
     (persis yang dikirim ke Tesseract). Gambar TANPA aturan (crop null) juga
     ikut Invert — produksi memakai prep Invert di SEMUA jalur. */
  if (crop && Array.isArray(crop.prep)) {
    PREPROC_KEYS.forEach(function(k) {
      var want = crop.prep.indexOf(k) !== -1;
      if (preprocOpts[k] !== want) applyPreprocToggle(k, want);
    });
  } else if (!crop) {
    PREPROC_KEYS.forEach(function(k) {
      var want = (k === 'invert');
      if (preprocOpts[k] !== want) applyPreprocToggle(k, want);
    });
  }
  /* Label area yang akan di-OCR — ditampilkan di status OCR agar mudah diverifikasi */
  _ocrCropLabel = crop
    ? (manualCrop ? 'Crop MANUAL x' + crop.cx + ',y' + crop.cy + ' · ' + crop.cw + '×' + crop.ch
                  : (crop.isOverride ? 'Crop OVERRIDE (user) · ' + crop.cw + '×' + crop.ch
                                     : (crop.isPhone ? 'Crop POTRET (HP) · ' + crop.cw + '×' + crop.ch
                                                     : 'Crop AUTO · ' + crop.cw + '×' + crop.ch)))
    : 'Seluruh gambar ' + sw + '×' + sh;
  _stage1Canvas = addStage(1, 'Gambar Asli', sw + '×' + sh, 'sumber: ' + currentName + ' — klik gambar untuk atur area OCR', orig,
    function() { openCropEditor(orig); });
  _overlayState = { orig: orig, crop: crop ? { cx: crop.cx, cy: crop.cy, cw: crop.cw, ch: crop.ch } : null };
  renderStage1();

  /* --- Crop (tahap 2) --- */
  var cropCanvas = orig;
  var cropInfo = { label: 'Tidak ada crop (aturan tidak cocok)', desc: '', cw: sw, ch: sh };
  if (crop) {
    cropCanvas = document.createElement('canvas');
    cropCanvas.width = crop.cw; cropCanvas.height = crop.ch;
    cropCanvas.getContext('2d').drawImage(orig, crop.cx, crop.cy, crop.cw, crop.ch, 0, 0, crop.cw, crop.ch);
    cropInfo = crop;
    if (!PREVIEW_MINIMAL) addStage(2, 'Hasil Crop (potongan)', crop.cw + '×' + crop.ch, crop.label + ' — ' + crop.desc, cropCanvas);
  } else {
    /* Tetap tampilkan tahap "crop" yang identik sebagai penanda aturan */
    if (!PREVIEW_MINIMAL) addStage(2, 'Hasil Crop (potongan)', sw + '×' + sh, cropInfo.label + ' — gambar dibiarkan utuh', orig);
  }
  /* OCR asli akan membaca AREA INI (bukan gambar asli penuh) — sesuai crop Anda */
  _ocrCropCanvas = cropCanvas;

  /* --- Skala (tahap 3, persis getPrep) — padding 2 px --- */
  var prep = computePrepInfo(cropInfo.cw, cropInfo.ch, cropIsUserArea, cropScaleFor(cropInfo, sw, sh), cropInfo && cropInfo.maxPixels);
  /* Scale pemenang auto-search (jika ada) menggantikan aturan — TANPA clamp 5MP
     (instruksi user: auto-search naik sampai ×4.0), hanya dibatasi ×4.0 */
  if (_autoScaleOverride) {
    var sa = Math.min(_autoScaleOverride, 4);
    prep = { scale: sa, dpi: Math.round(96 * sa), sw2: Math.round(cropInfo.cw * sa), sh2: Math.round(cropInfo.ch * sa) };
  }
  var scale = prep.scale;
  var dpi = prep.dpi;
  var PAD = 2; /* padding 2px di semua sisi (border putih) — dipilih user (sebelumnya 0, dikembalikan) */
  var sw2 = prep.sw2;
  var sh2 = prep.sh2;
  var scaled = document.createElement('canvas');
  scaled.width = sw2 + PAD * 2; scaled.height = sh2 + PAD * 2;
  var sctx = scaled.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, scaled.width, scaled.height);
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(cropCanvas, PAD, PAD, sw2, sh2);
  var scaleNote = 'scale ' + scale.toFixed(2) + '× · dpi ' + dpi + ' · canvas ' + scaled.width + '×' + scaled.height;
  if (!PREVIEW_MINIMAL) addStage(3, 'Skala ×' + scale.toFixed(2) + ' (padding 2 px)', scaled.width + '×' + scaled.height,
    'crop ' + cropInfo.cw + '×' + cropInfo.ch + ' → ' + sw2 + '×' + sh2 + ' (padding 2 px, putih)', scaled);   /* --- Preprocessing bertahap (tahap 4-15, persis getPrep + panel uji coba) ---
      Default SEMUA MATI di panel; produksi kini prep Invert (SEMUA aturan). Panel
      menyalakan tahap untuk uji coba (khususnya gambar kecil/buram) — canvas tahap
     TERAKHIR adalah HASIL AKHIR yang dikirim ke Tesseract (disimpan di _ocrFinalCanvas). */
  var applied = [];
  var upscaledApplied = false; /* untuk info bar Skala/DPI efektif */
  /* Tahap 4: Upscale 2× — perbesar teks kecil DULU (canvas baru, 2× dimensi),
     lalu semua filter berjalan di atas hasil perbesaran. Guard 5MP: kalau hasil
     2× akan melebihi batas pixel engine, upscale dilewati (khusus teks kecil). */
  if (preprocOpts.upscale) {
    if (sw2 * sh2 <= 1250000) { /* 1.25MP × 2× = 5MP ≈ cap engine */
      scaled = upscale2xCanvas(scaled, PAD, sw2, sh2);
      sw2 *= 2; sh2 *= 2;
      sctx = scaled.getContext('2d', { willReadFrequently: true });
      upscaledApplied = true;
      applied.push('Upscale 2×');
      if (!PREVIEW_MINIMAL) addStage(4, '+ Upscale 2× (upscale2xCanvas)', scaled.width + '×' + scaled.height,
        'diterapkan — untuk teks kecil, canvas 2× lebih besar', scaled);
    } else {
      if (!PREVIEW_MINIMAL) addStage(4, '+ Upscale 2× (upscale2xCanvas)', scaled.width + '×' + scaled.height,
        'SKIP — hasil 2× melebihi 5MP (canvas sumber ' + (sw2 * sh2 / 1e6).toFixed(1) + 'MP) — Upscale khusus teks kecil', scaled);
    }
  } else {
    if (!PREVIEW_MINIMAL) addStage(4, '+ Upscale 2× (upscale2xCanvas)', scaled.width + '×' + scaled.height,
      'SKIP — mati di panel pilihan', scaled);
  }
  var id = sctx.getImageData(0, 0, scaled.width, scaled.height);
  /* Tahap 5-15: filter per-tahap — urutan = PREPROC_KEYS setelah upscale */
  var PREPROC_SEQ = [
    { key: 'specks',   fn: function(im) { removeSpecks(im); },                 title: 'Buang Spek (removeSpecks)',                    use: 'gambar bernoise' },
    { key: 'median',   fn: function(im) { medianFilter(im, 1); },              title: 'Median (medianFilter 3×3)',                    use: 'noise butiran' },
    { key: 'dilate',   fn: function(im) { adaptiveDilate(im, cropInfo.cw, cropInfo.ch); }, title: 'Dilasi Adaptif (adaptiveDilate)',    use: 'teks tipis' },
    { key: 'erode',    fn: function(im) { erodeGray(im, 1); },                title: 'Erosi (erodeGray)',                           use: 'teks tebal / titik noise' },
    { key: 'contrast', fn: function(im) { enhanceContrast(im, 0.01); },       title: 'Kontras (enhanceContrast 0.01)',             use: 'gambar redup' },
    { key: 'clahe',    fn: function(im) { clahe(im, 8, 2); },                 title: 'CLAHE (clahe 8×8)',                           use: 'gambar buram' },
    { key: 'gamma',    fn: function(im) { gammaCorrect(im, 1.2); },           title: 'Gamma (gamma 1.2)',                           use: 'gambar terlalu gelap' },
    { key: 'otsu',     fn: function(im) { otsuThreshold(im); },               title: 'Binarisasi Otsu (otsuThreshold)',             use: 'kontras rendah' },
    { key: 'adaptive', fn: function(im) { adaptiveThreshold(im, 16); },       title: 'Binarisasi Adaptif (adaptiveThreshold 16)',   use: 'cahaya tidak merata' },
    { key: 'invert',   fn: function(im) { invert(im); },                      title: 'Invert (invert)',                             use: 'teks putih di latar gelap' },
    { key: 'sharpen',  fn: function(im) { sharpen(im); },                     title: 'Sharpen (sharpen)',                           use: 'teks buram' }
  ];
  var stageNum = 5;
  var lastSeq = PREPROC_SEQ[PREPROC_SEQ.length - 1];
  PREPROC_SEQ.forEach(function(p) {
    var isLast = (p === lastSeq);
    var note;
    if (preprocOpts[p.key]) {
      p.fn(id);
      sctx.putImageData(id, 0, 0);
      applied.push(PREPROC_LABEL[p.key]);
      note = 'diterapkan — untuk ' + p.use;
    } else {
      note = 'SKIP — mati di panel pilihan';
    }
    if (isLast) {
      note += applied.length
        ? ' — HASIL AKHIR = Skala → ' + applied.join(' → ')
        : ' — HASIL AKHIR = tanpa preprocessing (Skala)';
    }
    if (!PREVIEW_MINIMAL) {
      addStage(stageNum, '+ ' + p.title + (isLast ? ' — HASIL AKHIR' : ''),
        scaled.width + '×' + scaled.height, note, scaled);
    }
    stageNum++;
  });
  /* Canvas final TANPA padding untuk dikirim ke engine — engine menambah PAD 2px
     sendiri di getPrep (menghindari double-pad; padding hanya tampilan tahap 3-15).
     Salinan diambil SETELAH semua mutasi preprocessing, jadi piksel = tahap terakhir. */
  var finalCanvas = document.createElement('canvas');
  finalCanvas.width = sw2; finalCanvas.height = sh2;
  finalCanvas.getContext('2d').drawImage(scaled, PAD, PAD, sw2, sh2, 0, 0, sw2, sh2);
  _ocrFinalCanvas = finalCanvas;
  /* Mode minimal — satu kartu HASIL AKHIR (gambar yang benar-benar dikirim ke
     Tesseract, tanpa padding) menggantikan kartu tahap 2-15. */
  if (PREVIEW_MINIMAL) {
    addStage(2, 'HASIL AKHIR — dikirim ke Tesseract', _ocrFinalCanvas.width + '×' + _ocrFinalCanvas.height,
      applied.length
        ? 'hasil akhir = Skala → ' + applied.join(' → ')
        : 'hasil akhir = tanpa preprocessing (Skala)', _ocrFinalCanvas);
  }

  /* --- Info bar --- */
  renderInfo([
    { k: 'Sumber', v: currentName },
    { k: 'Dimensi', v: sw + '×' + sh },
    { k: 'Aturan crop', v: cropInfo.label, wide: true },
    { k: 'Potongan', v: cropInfo.cw + '×' + cropInfo.ch },
    { k: 'Skala', v: '×' + scale.toFixed(2) + (upscaledApplied ? ' → ×' + (scale * 2).toFixed(2) + ' (Upscale 2×)' : '') },
    { k: 'DPI', v: String(upscaledApplied ? Math.round(dpi * 2) : dpi) },
    { k: 'Canvas OCR', v: scaled.width + '×' + scaled.height },
    { k: 'Preprocessing', v: preprocSummary(), wide: true },
  ]);
  } catch (e) {
    console.error('Gagal memproses gambar:', e);
    var hint = emptyEl.querySelector('.hint');
    if (hint) hint.textContent = 'Gagal memuat gambar: ' + ((e && e.message) || e);
    emptyEl.style.display = 'block';
    stagesEl.classList.add('hidden');
    infoEl.classList.add('hidden');
  } finally {
    _inProcessBlob = false;
  }
}

/* =====================================================================
 * 4) GENERATOR CONTOH SCREENSHOT (untuk demo langsung)
 * ===================================================================== */
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function drawAdminLandscape(w, h, noiseSeed) {
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  var ctx = c.getContext('2d');
  ctx.fillStyle = '#eef2f7'; ctx.fillRect(0, 0, w, h);

  /* Top bar */
  ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, w, 52);
  ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 20px Segoe UI, sans-serif';
  ctx.fillText('ADMIN PANEL', 28, 34);
  ctx.fillStyle = '#94a3b8'; ctx.font = '13px Segoe UI, sans-serif';
  ctx.fillText('idrbo2.com/admin · transaction-record', w - 340, 33);

  /* Search bar */
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 52, w, 48);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
  ctx.fillRect(140, 62, 420, 28); ctx.strokeRect(140, 62, 420, 28);
  ctx.fillStyle = '#64748b'; ctx.font = '13px Segoe UI, sans-serif';
  ctx.fillText('Cari kode tiket / user ID…', 150, 81);
  ctx.fillStyle = '#2563eb'; ctx.fillRect(572, 62, 86, 28);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Segoe UI, sans-serif';
  ctx.fillText('Cari', 600, 82);

  /* Title */
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 22px Segoe UI, sans-serif';
  ctx.fillText('Riwayat Transaksi', 120, 148);

  /* Table */
  var cols = [
    { x: 120, w: 60,  t: 'No' },
    { x: 180, w: 240, t: 'User ID' },
    { x: 420, w: 380, t: 'Kode Tiket' },
    { x: 800, w: 200, t: 'Nilai' },
    { x: 1000, w: 460, t: 'Keterangan' },
    { x: 1460, w: 340, t: 'Status' }
  ];
  var ty = 168, rowH = 46, headH = 34;
  ctx.fillStyle = '#dbeafe'; ctx.fillRect(120, ty, 1680, headH);
  ctx.fillStyle = '#1e3a5f'; ctx.font = 'bold 13px Segoe UI, sans-serif';
  cols.forEach(function(col) { ctx.fillText(col.t, col.x + 12, ty + 22); });

  var rows = [
    { no: '1', user: 'U839201847', kode: '2083293626363948033', nilai: '10.000',   ket: 'PG-Mahjong Ways',   st: 'SUKSES' },
    { no: '2', user: 'U372816905', kode: '2083319475630221576', nilai: '25.000',   ket: 'PG-Mahjong Ways',   st: 'SUKSES' },
    { no: '3', user: 'U123456789', kode: '2083293626363948033', nilai: '100.000+', ket: 'PG-Mahjong Ways 2', st: 'SUKSES', hl: true },
    { no: '4', user: 'U927105364', kode: '2083421957402338719', nilai: '50.000+',  ket: 'PG-Mahjong Ways 2', st: 'DIPROSES' },
    { no: '5', user: 'U548210937', kode: '2083185072619334526', nilai: '5.000',    ket: 'PG-Mahjong Ways',   st: 'SUKSES' },
    { no: '6', user: 'U601938274', kode: '2083271845906238741', nilai: '20.000',   ket: 'PG-Mahjong Ways 2', st: 'GAGAL' }
  ];
  var plusPos = null;
  rows.forEach(function(row, ri) {
    var ry = ty + headH + ri * rowH;
    ctx.fillStyle = row.hl ? '#fef9c3' : (ri % 2 ? '#f8fafc' : '#fff');
    ctx.fillRect(120, ry, 1680, rowH);
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(120, ry + rowH); ctx.lineTo(1800, ry + rowH); ctx.stroke();
    ctx.fillStyle = '#334155'; ctx.font = '13px Segoe UI, sans-serif';
    ctx.fillText(row.no, 132, ry + 29);
    ctx.fillText(row.user, cols[1].x + 12, ry + 29);
    ctx.fillStyle = '#0f172a'; ctx.font = '13px Consolas, monospace';
    ctx.fillText(row.kode, cols[2].x + 12, ry + 29);
    ctx.fillStyle = row.nilai.indexOf('+') >= 0 ? '#b45309' : '#334155';
    ctx.font = 'bold 13px Consolas, monospace';
    ctx.fillText(row.nilai, cols[3].x + 12, ry + 29);
    if (row.nilai.indexOf('+') >= 0) {
      var tx = cols[3].x + 12 + ctx.measureText(row.nilai).width;
      plusPos = { x: tx - 7, y: ry + 23 };
    }
    ctx.fillStyle = '#475569'; ctx.font = '13px Segoe UI, sans-serif';
    ctx.fillText(row.ket, cols[4].x + 12, ry + 29);
    ctx.fillStyle = row.st === 'SUKSES' ? '#047857' : (row.st === 'GAGAL' ? '#b91c1c' : '#b45309');
    ctx.font = 'bold 12px Segoe UI, sans-serif';
    ctx.fillText(row.st, cols[5].x + 12, ry + 29);
  });

  /* Noise: spek kecil acak + spek yang sengaja menempel di sekitar simbol + */
  if (noiseSeed !== undefined) {
    var rnd = mulberry32(noiseSeed);
    ctx.fillStyle = '#0f172a';
    for (var i = 0; i < 1400; i++) {
      var nx = Math.floor(rnd() * w), ny = Math.floor(rnd() * h);
      var sz = rnd() < 0.3 ? 2 : 1;
      ctx.globalAlpha = 0.5 + rnd() * 0.5;
      ctx.fillRect(nx, ny, sz, sz);
    }
    ctx.globalAlpha = 1;
    /* Spek tepat di silang + — persis kasus "+ asli jadi 4" */
    if (plusPos) {
      for (var s = 0; s < 7; s++) {
        var ox = Math.floor((rnd() - 0.5) * 10), oy = Math.floor((rnd() - 0.5) * 10);
        ctx.globalAlpha = 0.6 + rnd() * 0.4;
        ctx.fillRect(plusPos.x + ox, plusPos.y + oy, 1, 1);
        ctx.fillRect(plusPos.x + ox, plusPos.y + oy + 1, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
  }
  return c;
}

function drawAdminPortrait(w, h) {
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  var ctx = c.getContext('2d');
  ctx.fillStyle = '#eef2f7'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, w, 56);
  ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 18px Segoe UI, sans-serif';
  ctx.fillText('ADMIN PANEL', 24, 38);

  /* Kartu kiri — harus muat di strip KIRI 50% (crop potret HP: kode tiket + user ID).
     Posisi proporsional agar demo 720×1600 maupun 1500×2622 sama-sama masuk area crop. */
  var cardX = Math.round(w * 0.04);
  var cardW = Math.round(w * 0.44);
  var tx = cardX + 28;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#cbd5e1';
  ctx.fillRect(cardX, 120, cardW, 480); ctx.strokeRect(cardX, 120, cardW, 480);
  ctx.fillStyle = '#1e3a5f'; ctx.font = 'bold 15px Segoe UI, sans-serif';
  ctx.fillText('Detail Tiket', tx, 156);
  ctx.fillStyle = '#64748b'; ctx.font = '13px Segoe UI, sans-serif';
  ctx.fillText('User ID', tx, 196);
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 17px Segoe UI, sans-serif';
  ctx.fillText('U123456789', tx, 222);
  ctx.fillStyle = '#64748b'; ctx.font = '13px Segoe UI, sans-serif';
  ctx.fillText('Kode Tiket', tx, 264);
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 17px Consolas, monospace';
  ctx.fillText('2083293626363948033', tx, 292);
  ctx.fillStyle = '#64748b'; ctx.font = '13px Segoe UI, sans-serif';
  ctx.fillText('Nilai Taruhan', tx, 334);
  ctx.fillStyle = '#b45309'; ctx.font = 'bold 17px Consolas, monospace';
  ctx.fillText('100.000+', tx, 362);
  ctx.fillStyle = '#64748b'; ctx.font = '13px Segoe UI, sans-serif';
  ctx.fillText('Keterangan', tx, 404);
  ctx.fillStyle = '#0f172a'; ctx.font = '14px Segoe UI, sans-serif';
  ctx.fillText('PG-Mahjong Ways 2', tx, 430);

  /* Kartu kanan — DI LUAR strip kiri-50% → terpotong (simulasi data yang dibuang) */
  var rightX = Math.round(w * 0.54);
  ctx.fillStyle = '#e2e8f0'; ctx.fillRect(rightX, 120, 420, 300);
  ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 13px Segoe UI, sans-serif';
  ctx.fillText('Tabel riwayat lain…', rightX + 20, 150);
  for (var i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 ? '#f8fafc' : '#fff';
    ctx.fillRect(rightX, 178 + i * 44, 420, 44);
    ctx.fillStyle = '#64748b'; ctx.font = '11px Consolas, monospace';
    ctx.fillText('2083' + String(100000000000000000 + i * 137), rightX + 16, 206 + i * 44);
  }
  return c;
}

function canvasToBlob(canvas) {
  return new Promise(function(res) { canvas.toBlob(function(b) { res(b); }, 'image/png'); });
}

/* =====================================================================
 * AUTO CARI SCALE — prep Invert DEFAULT (keys ['invert']): scale NAIK TERUS
 * dari setting terakhir kita (Perbesaran OCR, mis. ×1.6) langkah ×0.1,
 * sampai bestcode / '+Ambil' terbaca → SETOP & tampilkan pemenang.
 * Hasil dinilai dari kode tiket 19 digit + bestcode (getAllBestCodes di
 * ocr-common). Kalau +Ambil tidak terbaca sampai scale maks → hasil
 * ditandai BELUM lengkap (autoNoBest), bukan pemenang penuh.
 * ===================================================================== */
function autoPrepLabel(keys) {
  return keys.length ? keys.map(function(k) { return PREPROC_LABEL[k]; }).join(' + ') : 'tanpa prep';
}

/* Bangun canvas kandidat: crop → skala (TANPA clamp 5MP — auto-search boleh membesar
   sampai ×4.0 agar teks kecil benar-benar membesar) → upscale 2× (jika diizinkan) → filter */
function buildAutoCanvas(cropCanvas, scale, keys) {
  var cw = cropCanvas.width, ch = cropCanvas.height;
  var s = Math.min(scale, 4);
  var sw2 = Math.round(cw * s), sh2 = Math.round(ch * s);
  var PAD = 2;
  var cv = document.createElement('canvas');
  cv.width = sw2 + PAD * 2; cv.height = sh2 + PAD * 2;
  var ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cropCanvas, PAD, PAD, sw2, sh2);
  /* Upscale 2× dulu (sebelum filter) — lewati jika hasil 2× melebihi 5MP */
  keys.forEach(function(k) {
    if (k === 'upscale' && sw2 * sh2 <= 1250000) {
      cv = upscale2xCanvas(cv, PAD, sw2, sh2);
      sw2 *= 2; sh2 *= 2;
      ctx = cv.getContext('2d', { willReadFrequently: true });
    }
  });
  var id = ctx.getImageData(0, 0, cv.width, cv.height);
  keys.forEach(function(k) {
    if (k === 'sharpen') { sharpen(id); ctx.putImageData(id, 0, 0); }
    else if (k === 'otsu') { otsuThreshold(id); ctx.putImageData(id, 0, 0); }
    else if (k === 'adaptive') { adaptiveThreshold(id, 16); ctx.putImageData(id, 0, 0); }
    else if (k === 'median') { medianFilter(id, 1); ctx.putImageData(id, 0, 0); }
    else if (k === 'clahe') { clahe(id, 8, 2); ctx.putImageData(id, 0, 0); }
    else if (k === 'invert') { invert(id); ctx.putImageData(id, 0, 0); } /* prep Invert — default Auto Scale */
  });
  return cv;
}

/* Skor hasil OCR — prioritas kode tiket 19 digit valid (extractCodes) + bestcode.
   CERDAS: selain kode penuh, beri kredit parsial untuk potongan digit & konteks
   nilai taruhan '+' — pencarian jadi bisa KONVERGEN ke scale/prep yang paling
   banyak membaca digit (bukan cuma hitam-putih "ada kode / tidak ada kode"). */
function scoreOcrText(text) {
  if (!text) return 0;
  /* Dedup kode — pass utama & corner-pass bisa membaca kode yang SAMA → tanpa dedup
     1 kode dihitung 2× (200k) dan menggelembungkan skor kandidat. */
  var codes = [];
  extractCodes(text).forEach(function(c) { if (codes.indexOf(c) === -1) codes.push(c); });
  var score = codes.length * 100000;
  /* BESTCODE (kode '+Ambil' — berdekatan dengan nilai taruhan '+') jauh lebih
     penting: bonus besar supaya kandidat yang menemukan bestcode MENANG atas
     kandidat yang cuma menemukan kode biasa. Logika deteksi SAMA dengan produksi
     (getAllBestCodes di ocr-common). */
  var bestCodes = getAllBestCodes(text.split('\n').filter(Boolean), codes, false);
  score += bestCodes.length * 400000;
  getTokens(text).forEach(function(t) {
    if (t.length >= 16 && t[0] === '2') score += 5000;   /* potongan kode hampir utuh */
    else if (t.length >= 10 && t[0] === '2') score += 300;
    else if (t.length >= 10) score += 60;
    score += Math.min(t.length, 12);                      /* semakin banyak digit terbaca makin baik */
  });
  /* Konteks BESTCODE: baris berisi '+' diikuti digit (nilai taruhan) = pertanda
     bestcode ada di baris sebelahnya. Kredit kecil → kandidat yang membaca baris
     '+' didahulukan, sehingga bestcode tidak hilang dari hasil akhir. */
  text.split('\n').forEach(function(ln) {
    if (/\+[\s]*[0-9.,]+/.test(ln)) score += 1500;
    var d = (ln.match(/\d/g) || []).length;
    var nd = (ln.match(/[^0-9\s]/g) || []).length;
    if (d > 0 && nd > d * 2) score -= 400;               /* baris penuh garbage non-digit */
  });
  if (text.replace(/\s/g, '').length < 8) score -= 20000; /* OCR gagal / area kosong */
  if (text.length > 4000) score -= 800;                   /* garbage parah */
  return score;
}

async function autoRunCandidate(cropCanvas, scale, keys, st) {
  /* User klik "Jalankan OCR" saat pencarian jalan → hentikan tanpa memproses kandidat.
     String unik 'auto-search:cancel' — bukan string umum 'cancel' agar tidak
     menelan error engine lain yang kebetulan berpesan sama. */
  if (_autoCancel) throw new Error('auto-search:cancel');
  var cv = buildAutoCanvas(cropCanvas, scale, keys);
  var blob = await canvasToBlob(cv);
  var url = URL.createObjectURL(blob);
  var res;
  try {
    /* Scan kandidat memakai pipeline yang TIDAK mengubah blob (noAutoCrop/noPhoneCrop/
       cropScale=1 — canvas kandidat sudah di skala+prep oleh buildAutoCanvas) TAPI
       dengan allowCorner:true — engine menjalankan corner-pass (strip atas, zoom)
       yang biasanya dilewati untuk isCrop. Corner-pass inilah yang menemukan kode
       di area atas yang terlewat pass utama (akar masalah "Tidak ada kode tiket
       terdeteksi"). noPrep tetap dikirim: blob tidak boleh diproses ulang. */
    res = await _engine.detectFromImage(url, 0, blob, { noPrep: true, noAutoCrop: true, noPhoneCrop: true, cropScale: 1, allowCorner: true });
  } finally {
    URL.revokeObjectURL(url);
  }
  /* detectFromImage mengembalikan field text (v2.91+). Fallback untuk module engine
     lama/cache: gabungkan rawTexts (teks SEMUA pass termasuk corner-pass) — allRaw
     TIDAK cukup (hanya berisi pass yang menemukan kode → kredit parsial hilang). */
  var text = '';
  if (res) {
    text = res.text ||
      (res.rawTexts && res.rawTexts.length
        ? res.rawTexts.map(function(t, i) { return '── pass ' + (i + 1) + ' ──\n' + t; }).join('\n')
        : '') ||
      res.allRaw || '';
  }
  var score = scoreOcrText(text);
  var candCodes = extractCodes(text);
  /* Deteksi bestcode / '+Ambil' LANGSUNG (bukan lewat ambang skor) — dipakai
     CLIMB untuk berhenti PERSIS saat bestcode terbaca. Logika sama produksi
     (getAllBestCodes di ocr-common). */
  var candBest = getAllBestCodes(text.split('\n').filter(Boolean), candCodes, false);
  if (st) st.textContent = '🔎 Auto: ×' + scale.toFixed(2) + ' · ' + autoPrepLabel(keys) + ' → skor ' + score;
  /* Diagnostik ringkas per kandidat — teks mentah penuh hanya dicatat untuk
     pemenang (console.warn di blok autoSearchBest). */
  console.log('[auto-search] kandidat ×' + scale.toFixed(2) + ' · ' + autoPrepLabel(keys) +
    ' → skor ' + score + ' · kode: ' + (extractCodes(text).join(', ') || '-') +
    ' · teks: ' + (text ? text.replace(/\s+/g, ' ').slice(0, 200) : '(kosong)'));
  /* Canvas kandidat ikut dikembalikan — canvas PEMENANG (persis yang di-OCR,
     berisi kode tiket yang dinilai) dipakai untuk scan final & tampilan gambar.
     Penting: TIDAK boleh diganti canvas pipeline rebuild — hasil bisa beda. */
  return { scale: scale, keys: keys, score: score, text: text, canvas: cv, bestCodes: candBest };
}

/* Bangun prompt INSTRUKSI OCR dari pemenang (format sama dengan updateCropPrompt).
   Scale pemenang ditulis APA ADANYA (maks ×4.0, tanpa clamp 5MP) — prompt harus
   jujur menyebutkan perbesaran yang benar-benar dipakai saat bestcode terbaca. */
function buildAutoPrompt(crop, srcW, srcH, scale, keys) {
  var PAD = 2;
  var s = Math.min(scale, 4);
  var sw2 = Math.round(crop.cw * s), sh2 = Math.round(crop.ch * s);
  var dpi = Math.round(96 * s);
  var labels = keys.map(function(k) { return PREPROC_LABEL[k]; });
  var prepLine = labels.length ? labels.join(' + ') : 'tanpa preprocessing (semua dimatikan)';
  var prepPhrase = labels.length ? 'terapkan preprocessing: ' + labels.join(' + ') : 'tanpa preprocessing (semua tahap dimatikan)';
  var pct = Math.round(crop.cw * crop.ch / (srcW * srcH) * 100);
  return [
    'INSTRUKSI OCR — AREA MANUAL', '',
    'Screenshot asli: ' + srcW + '×' + srcH + ' px',
    'Area OCR: x=' + crop.cx + ', y=' + crop.cy + ', lebar ' + crop.cw + ', tinggi ' + crop.ch + ' px (' + pct + '% dari gambar)',
    'Perbesaran zoom: ×' + s.toFixed(2) + ' dari gambar asli (DPI ' + dpi + ')',
    'Ukuran yang diproses: ' + sw2 + '×' + sh2 + ' px (canvas ' + (sw2 + PAD * 2) + '×' + (sh2 + PAD * 2) + ' dengan padding 2 px)',
    'Preprocessing: ' + prepLine, '',
    'PROMPT:',
    '"Lakukan OCR hanya pada area yang ditandai pada gambar asli: kotak x=' + crop.cx + ', y=' + crop.cy + ' dengan lebar ' + crop.cw + ' dan tinggi ' + crop.ch + ' piksel. Perbesar area tersebut ' + s.toFixed(2) + '× dari gambar asli, ' + prepPhrase + '. Baca seluruh teks di dalam area itu, terutama kode tiket dan user ID."'
  ].join('\n');
}    /* Driver auto-search: naik scale dari setting terakhir (prep Invert) sampai
       bestcode / '+Ambil' terbaca, mentok di ×4.0 → terapkan pemenang. */
async function autoSearchBest() {
  if (_autoBusy || _ocrBusy) return;
  if (!currentBlob) { $('ocrStatus').textContent = 'Muat gambar terlebih dahulu'; return; }
  await ensureTesseract();
  if (!_engine) _engine = initOcrEngine();
  _autoBusy = true;
  var st = $('ocrStatus');
  var btn = $('btnAuto');
  /* Tombol "Jalankan OCR" TIDAK di-disable selama auto-search — user boleh klik
     kapan saja; klik akan membatalkan pencarian (lihat runOcr/_autoCancel). */
  if (btn) btn.disabled = true;
  try {
    var cropCanvas = _ocrCropCanvas || _ocrFinalCanvas;
    if (!cropCanvas || !cropCanvas.width) { st.textContent = 'Belum ada area crop — buat crop dulu'; return; }
    var blobAtStart = currentBlob; /* identitas gambar saat pencarian dimulai — deteksi race gambar basi */
    var srcDims = _lastSrcDims || { w: cropCanvas.width, h: cropCanvas.height };
    var cropRect = _lastManualCrop
      ? { cx: _lastManualCrop.cx, cy: _lastManualCrop.cy, cw: _lastManualCrop.cw, ch: _lastManualCrop.ch }
      : (_lastCropRule ? { cx: _lastCropRule.cx, cy: _lastCropRule.cy, cw: _lastCropRule.cw, ch: _lastCropRule.ch }
                        : { cx: 0, cy: 0, cw: cropCanvas.width, ch: cropCanvas.height });
    /* AUTO SCALE — prep Invert DEFAULT (keys ['invert']): mulai dari SETTING TERAKHIR
       kita (Perbesaran OCR, mis. ×1.6) lalu NAIK terus langkah ×0.1 sampai bestcode /
       '+Ambil' terbaca. MENTOK di ×4.0 (instruksi user) — TANPA clamp pixel cap 5MP:
       canvas kandidat membesar BENERAN tiap step (buildAutoCanvas), jadi scale
       tinggi punya efek nyata pada pembacaan teks kecil. */
    var startScale = Math.max(1.0, Math.min(_cropScale, 4)); /* min ×1.0 (instruksi user) */
    var maxScale = 4; /* mentok di ×4.0 */
    var scaleList = [];
    var effSeen = {};
    function addClimbScale(s) {
      if (s < 1.0 || s > 4) return; /* min ×1.0 (instruksi user) */
      var eff = Math.round(s * 10) / 10;
      if (effSeen[eff]) return;
      effSeen[eff] = true;
      scaleList.push(s);
    }
    addClimbScale(startScale);
    for (var _s = Math.round((startScale + 0.1) * 10) / 10; _s <= maxScale + 0.0001; _s += 0.1) {
      addClimbScale(Math.round(_s * 10) / 10);
    }
    if (!scaleList.length) scaleList = [Math.min(startScale, 4)];
    var tried = {};
    var best = null;
    async function scanCandidate(scale, keys) {
      var key = scale.toFixed(2) + '|' + keys.join(',');
      if (tried[key]) return null;
      tried[key] = true;
      var r = await autoRunCandidate(cropCanvas, scale, keys, st);
      if (r && (!best || r.score > best.score)) best = r;
      return r;
    }
    /* CLIMB — scan dengan prep Invert (default) dari setting terakhir kita naik
       terus; SETOP saat bestcode / '+Ambil' terbaca (deteksi LANGSUNG lewat
       getAllBestCodes — bukan ambang skor, yang bisa palsu dari banyak kode biasa). */
    st.textContent = '🤖 Auto Scale: mulai ×' + scaleList[0].toFixed(2) + ' · Invert → naik terus sampai bestcode…';
    for (var i = 0; i < scaleList.length; i++) {
      var r = await scanCandidate(scaleList[i], ['invert']);
      /* bestcode / '+Ambil' ketemu → SETOP. PIN kandidat ini sebagai pemenang
         (best bisa berbeda — skor tertinggi sejauh ini — dan mungkin TANPA bestcode,
         mis. 4+ kode biasa ≈ 400k mengalahkan kandidat bestcode). */
      if (r && r.bestCodes && r.bestCodes.length) { best = r; break; }
    }
    /* KONFIRMASI (hanya jika bestcode belum ketemu): Tesseract non-deterministik
       (hasil bisa beda antar scan gambar yang sama) — scan ulang canvas pemenang
       BEBERAPA KALI & GABUNG teks terbaik → peluang tertinggi menangkap baris nilai
       '+' yang terlewat scan pertama, sehingga bestcode (kode '+Ambil') tidak lolos
       dari hasil akhir. Instruksi user: "lanjut terus sampai ketemu" — jadi dicoba
       sampai 3× sebelum menyatakan TANPA +Ambil. Jika bestcode sudah ada → lewati. */
    if (best && best.text) {
      var winCodes0 = extractCodes(best.text);
      var winBest0 = getAllBestCodes(best.text.split('\n').filter(Boolean), winCodes0, false);
      var _confirmPass = 0;
      while (winBest0.length === 0 && _confirmPass < 3) {
        _confirmPass++;
        var c1 = await autoRunCandidate(cropCanvas, best.scale, best.keys, st);
        if (c1 && c1.text && c1.text !== best.text) {
          var mergedText = best.text + '\n── scan konfirmasi ──\n' + c1.text;
          if (scoreOcrText(mergedText) > best.score) {
            best.text = mergedText;
            best.score = scoreOcrText(mergedText);
          }
        }
        winCodes0 = extractCodes(best.text);
        winBest0 = getAllBestCodes(best.text.split('\n').filter(Boolean), winCodes0, false);
      }
    }
    /* Gambar/crop BERUBAH saat pencarian jalan → jangan terapkan pemenang basi */
    if (currentBlob !== blobAtStart || _ocrCropCanvas !== cropCanvas) {
      st.textContent = '⏸ Auto dibatalkan — gambar/crop berubah saat pencarian.';
      return;
    }
    /* Terapkan pemenang: scale override + toggle prep + re-render pipeline.
       Di-AWAIT supaya kartu HASIL AKHIR di pipeline benar-benar menampilkan
       hasil pemenang sebelum scan final dijalankan (renderWithPreproc
       adalah async — processBlob). */
    _autoScaleOverride = best.scale;
    PREPROC_KEYS.forEach(function(k) {
      var want = best.keys.indexOf(k) !== -1;
      if (preprocOpts[k] !== want) applyPreprocToggle(k, want);
    });
    await renderWithPreproc();
    /* Prompt pemenang untuk disalin */
    var prompt = buildAutoPrompt(cropRect, srcDims.w, srcDims.h, best.scale, best.keys);
    var ta = $('autoPrompt');
    if (ta) { ta.value = prompt; $('autoPromptWrap').style.display = 'block'; }
    /* Tampilkan HASIL PEMENANG langsung dari scan kandidat yang menang — teks &
       kode tiket PERSIS yang dinilai (bukan scan ulang yang bisa beda hasil,
       bukan canvas pipeline rebuild). Ini menjamin kode tiket (bestcode) yang
       ditemukan pencarian SELALU muncul di hasil. */
    _autoWinnerMeta = { scale: best.scale, keys: best.keys.slice(), canvas: best.canvas };
    var codes = extractCodes(best.text);
    /* Deteksi BESTCODE (kode tiket '+Ambil' — berdekatan dengan nilai taruhan '+')
       memakai logika yang SAMA dengan produksi (getAllBestCodes di ocr-common). */
    var bestCodes = getAllBestCodes(best.text.split('\n').filter(Boolean), codes, false);
    var resOut = {
      codes: codes,
      bestCodes: bestCodes,
      codeInfo: {},
      allRaw: best.text,
      autoWinner: true,
      autoNoBest: bestCodes.length === 0 /* +Ambil tidak ditemukan → tandai hasil belum lengkap */
    };
    codes.forEach(function(c) { resOut.codeInfo[c] = { count: 1 }; });
    renderOcrResult(resOut);
    /* Diagnostik: bila tidak ada kode terbaca, tampilkan petunjuk + log teks
       mentah agar penyebabnya terlihat (bukan hasil kosong misterius). */
    if (!codes.length) {
      console.warn('[auto-search] Tidak ada kode tiket pada pemenang. Teks OCR mentah (×' + best.scale.toFixed(2) + ' · ' + autoPrepLabel(best.keys) + '):', best.text);
    }
    if (bestCodes.length) {
      st.textContent = '✅ Auto selesai: ×' + best.scale.toFixed(2) + ' · ' + autoPrepLabel(best.keys) +
        ' (skor ' + best.score + ') — bestcode: ' + bestCodes.join(', ') +
        ' · semua kode: ' + (codes.join(', ') || 'tidak terbaca') + ' — hasil & prompt siap disalin.';
    } else {
      st.textContent = '⚠️ Auto selesai TANPA +Ambil: bestcode tidak terbaca sampai ×' +
        scaleList[scaleList.length - 1].toFixed(2) + ' (mentok ×4.0, prep Invert) setelah ' +
        scaleList.length + ' scale + konfirmasi — hasil terbaik ditampilkan tapi BELUM lengkap. ' +
        'Coba perbesar area crop atau cek gambar.';
    }
  } catch (e) {
    if (e && e.message === 'auto-search:cancel') {
      /* User klik "Jalankan OCR" → pencarian dibatalkan (bukan kegagalan);
         status akan di-overwrite oleh runOcr yang sedang berjalan. */
      return;
    }
    console.error('Auto search gagal:', e);
    st.textContent = '⚠️ Auto search gagal: ' + e;
  } finally {
    _autoBusy = false;
    _autoCancel = false; /* reset flag cancel — pencarian selesai/dibatalkan */
    _autoWinnerMeta = null; /* meta pemenang hanya berlaku untuk scan final ini */
    if (btn) btn.disabled = false;
  }
}

async function loadDemoCanvas(canvas, name) {
  var blob = await canvasToBlob(canvas);
  await processBlob(blob, name);
}

/* =====================================================================
 * 5) OCR ASLI (hanya di konteks extension — chrome.runtime tersedia)
 * ===================================================================== */
function isExtension() {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
}

var _engine = null, _ocrBusy = false;

/* Tesseract dimuat STATIS via <script src="../lib/tesseract.min.js"> di ocr-preview.html
   (pola sama dashboard/popup/offscreen). Jalur ini hanya memastikan sudah ter-load. */
function ensureTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return Promise.reject(new Error('Tesseract belum ter-load — cek script lib/tesseract.min.js di ocr-preview.html'));
}

async function runOcr() {
  if (_ocrBusy) return; /* OCR lain sedang berjalan */
  /* Auto-search sedang jalan → batalkan; OCR langsung berjalan (tombol TIDAK
     pernah nonaktif karena auto-search — sebelumnya tombol di-disable selama
     pencarian 5-20 detik & klik tampak tidak berfungsi). */
  if (_autoBusy) {
    _autoCancel = true;
    $('ocrStatus').textContent = '⏹ Membatalkan pencarian auto… OCR akan segera dimulai.';
  }
  if (!currentBlob) { $('ocrStatus').textContent = 'Muat gambar terlebih dahulu'; return; }
  _ocrBusy = true;
  var st = $('ocrStatus');
  st.textContent = 'Menyiapkan worker best…';
  $('btnOcr').disabled = true;
  try {
    await ensureTesseract();
    if (!_engine) _engine = initOcrEngine();
    /* TIDAK panggil ensureReady() — itu pre-warm 4 worker (2 pool) yang boros untuk
       satu scan di tab preview. detectFromImage sendiri menginisialisasi pool yang
       dipakai (pool 0, 2 worker best) → start lebih cepat. */
    /* OCR ASLI memakai CANVAS FINAL pipeline (tahap TERAKHIR — crop → skala → preprocessing
       sesuai pilihan panel):
       - crop MANUAL / area OVERRIDE / crop POTRET (_ocrIsCrop=true) → kirim canvas
         final preview (sudah di skala & diproses) + noAutoCrop/noPhoneCrop/cropScale=1:
         engine tidak auto-crop & tidak mengubah skala — hasil = PERSIS tahap 7.
       - tanpa crop → canvas penuh dikirim; aturan auto-crop (PHONE_CROP) tetap berlaku
         di engine untuk gambar potret (konsisten dengan produksi).
       noPrep selalu dikirim: blob preview sudah FINAL — preprocessing panel (jika ada)
       sudah diterapkan di demo untuk uji coba; engine tidak boleh memproses ulang. */
    var ocrBlob = currentBlob;
    if (_ocrIsCrop && _ocrFinalCanvas && _ocrFinalCanvas.width > 0 && _ocrFinalCanvas.height > 0) {
      ocrBlob = await canvasToBlob(_ocrFinalCanvas);
    } else if (_ocrCropCanvas && _ocrCropCanvas.width > 0 && _ocrCropCanvas.height > 0) {
      ocrBlob = await canvasToBlob(_ocrCropCanvas);
    }
    st.textContent = 'OCR berjalan pada: ' + (_ocrCropLabel || 'area crop Anda') + ' (PSM 3, model best)…';
    var url = URL.createObjectURL(ocrBlob);
    /* Baca ulang setting dari storage SEBELUM OCR — jangan pakai snapshot basi saat tab
       dibuka, supaya zoom preview = zoom livechat (keduanya baca storage yang sama). */
    await loadCropScale();
    var scaleOpts = {};
    /* noPrep SELALU dikirim: blob yang dikirim sudah final (crop+skala+preprocessing
       panel preview — engine tidak boleh memproses ulang). */
    scaleOpts.noPrep = true;
    /* allowCorner SELALU dikirim (sama dengan scan kandidat auto-search): untuk crop
       (isCrop) engine melewati corner-pass kecuali flag ini ada — tanpa flag, klik
       "Jalankan OCR" manual bisa ketinggalan kode tiket di area atas yang justru
       ditemukan pemenang auto. Untuk non-crop corner-pass sudah otomatis jalan. */
    scaleOpts.allowCorner = true;
    if (_ocrIsCrop) {
      scaleOpts.noAutoCrop = true;
      scaleOpts.noPhoneCrop = true;
      /* Blob preview sudah di skala FINAL → engine tidak boleh mengubah skala (×1).
         cropScaleFor hanya fallback bila canvas final belum tersedia. */
      scaleOpts.cropScale = (_ocrFinalCanvas && _ocrFinalCanvas.width > 0)
        ? 1
        : (_lastCropRule && _lastSrcDims ? cropScaleFor(_lastCropRule, _lastSrcDims.w, _lastSrcDims.h) : undefined);
    }
    var res = await _engine.detectFromImage(url, 0, ocrBlob, scaleOpts);
    URL.revokeObjectURL(url);
    if (res && res.error) {
      /* Engine mengembalikan error TANPA melempar exception — jangan disembunyikan */
      st.textContent = 'Gagal: ' + res.error;
    } else {
      renderOcrResult(res);
      var diag = '';
      if (res.engineVersion) diag += ' · v' + res.engineVersion.replace(/^v/, '');
      if (res.procInfo && res.procInfo.scale) {
        var pi = res.procInfo;
        diag += ' · ' + pi.scale.toFixed(2) + '× ' + pi.sw + '×' + pi.sh;
        if (pi.src) diag += ' · src:' + pi.src;
        /* Hash piksel canvas akhir — sama = canvas identik (beda hasil = sumber beda) */
        if (pi.hash) diag += ' · #' + pi.hash;
      }
      st.textContent = 'Selesai — ' + (_ocrCropLabel || 'OCR') + (res.elapsed ? ' · ' + res.elapsed + ' dtk' : '') + diag;
    }
  } catch (e) {
    console.error('OCR preview error:', e);
    st.textContent = 'Gagal: ' + ((e && e.message) || e);
  } finally {
    _ocrBusy = false;
    $('btnOcr').disabled = false;
  }
}

function renderOcrResult(res) {
  var codesEl = $('ocrCodes'), rawEl = $('ocrRaw');
  codesEl.innerHTML = '';
  var hasAny = (res.codes && res.codes.length) || (res.bestCodes && res.bestCodes.length);
  if (res.autoWinner) {
    /* Penanda bahwa hasil ini dari auto-search, bukan klik Jalankan OCR */
    var hdr = document.createElement('div');
    hdr.className = 'auto-result-hdr' + (res.autoNoBest ? ' warn' : ''); /* .warn → font merah, lihat CSS */
    hdr.textContent = res.autoNoBest
      ? '🤖 Hasil Auto Scale — ⚠️ TANPA +Ambil (hasil belum lengkap)'
      : '🤖 Hasil Auto Scale — hasil OCR final pemenang';
    codesEl.appendChild(hdr);
    /* Tampilkan GAMBAR hasil akhir pemenang — canvas KANDIDAT persis yang di-scan
       pada scan final (berisi kode tiket yang dinilai). */
    var aw = $('autoResultWrap'), ac = $('autoResultImg');
    var meta = _autoWinnerMeta || {};
    var metaScale = meta.scale;
    var metaKeys = meta.keys || [];
    var winCanvas = meta.canvas;
    if (aw && ac && winCanvas && winCanvas.width > 0) {
      var label = $('autoResultLabel');
      if (label) {
        label.textContent = '🏆 Hasil Akhir Pemenang: ×' + (metaScale ? metaScale.toFixed(2) : '?') + ' · ' +
          (metaKeys.length
            ? metaKeys.map(function(k) { return PREPROC_LABEL[k]; }).join(' + ')
            : 'tanpa prep') + ' — canvas persis yang di-OCR pada scan final (klik untuk zoom)';
      }
      ac.width = winCanvas.width; ac.height = winCanvas.height;
      ac.getContext('2d').drawImage(winCanvas, 0, 0);
      aw.style.display = 'block';
    }
  } else {
    /* OCR biasa (klik Jalankan OCR) — sembunyikan area hasil pemenang auto */
    var aw2 = $('autoResultWrap');
    if (aw2) aw2.style.display = 'none';
  }
  if (hasAny) {
    (res.codes || []).forEach(function(code) {
      var info = (res.codeInfo && res.codeInfo[code]) || {};
      var chip = document.createElement('div');
      var isBest = (res.bestCodes || []).indexOf(code) >= 0;
      chip.className = 'ocr-chip' + (isBest ? ' best' : '');
      chip.textContent = code;
      var src = document.createElement('span');
      src.className = 'src';
      src.textContent = (info.count ? info.count + '×' : '') + (isBest ? ' ★ +Ambil' : '');
      chip.appendChild(src);
      codesEl.appendChild(chip);
    });
  } else {
    codesEl.innerHTML = '<div class="ocr-chip" style="background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.35);color:#fca5a5;">Tidak ada kode tiket terdeteksi — lihat teks mentah OCR di bawah untuk melihat apa yang sebenarnya terbaca</div>';
  }
  rawEl.innerHTML = '';
  if (res.allRaw) {
    var div = document.createElement('div');
    res.allRaw.split('\n').forEach(function(line) {
      var row = document.createElement('div');
      if (/^──/.test(line.trim())) { row.className = 'sep'; row.textContent = line; }
      else row.textContent = line;
      div.appendChild(row);
    });
    rawEl.appendChild(div);
  }
  $('ocrPanel').classList.remove('hidden');
  $('ocrPanel').style.display = ''; /* bersihkan inline display:none (konteks demo) */
}

/* =====================================================================
 * 5.5) EDITOR CROP MANUAL — klik "Gambar Asli" untuk atur area OCR
 * Area dipilih pada gambar UKURAN ASLI; perbesaran (zoom) dari asli dan
 * prompt dihitung PERSIS seperti pipeline (isCrop: cap 1.5×).
 * ===================================================================== */
var _cropEdit = {
  img: null,          /* canvas sumber ukuran asli */
  sel: null,          /* {x, y, w, h} dalam piksel asli */
  prevSel: null,      /* seleksi saat editor DIBUKA — dipulihkan saat BATAL (ESC) */
  mode: 'none',       /* draw | move | nw | ne | sw | se */
  start: { x: 0, y: 0 },
  orig: null,         /* posisi awal saat mulai move/resize */
  zoom: 1             /* zoom tampilan editor (bukan zoom OCR) */
};
var _inProcessBlob = false; /* guard: closeCropEditor tidak boleh memicu re-render saat processBlob jalan */

function openCropEditor(origCanvas) {
  _cropEdit.img = origCanvas;
  var cv = $('cropStageCanvas');
  cv.width = origCanvas.width; cv.height = origCanvas.height;
  /* Default: area crop yang sedang aktif (auto atau manual sebelumnya) */
  var c = _overlayState && _overlayState.crop;
  if (c && c.cw && c.ch && c.cw <= cv.width && c.ch <= cv.height) {
    _cropEdit.sel = { x: c.cx, y: c.cy, w: c.cw, h: c.ch };
  } else {
    var iw = Math.round(cv.width * 0.7), ih = Math.round(cv.height * 0.7);
    _cropEdit.sel = { x: Math.round((cv.width - iw) / 2), y: Math.round((cv.height - ih) / 2), w: iw, h: ih };
  }
  /* Simpan seleksi awal — dipakai tombol BATAL/ESC untuk memulihkannya. */
  _cropEdit.prevSel = { x: _cropEdit.sel.x, y: _cropEdit.sel.y, w: _cropEdit.sel.w, h: _cropEdit.sel.h };
  _cropEdit.mode = 'none';
  _cropEdit.zoom = 1;
  $('cropImgDim').textContent = cv.width + '×' + cv.height + ' px';
  $('cropModal').classList.remove('hidden');
  layoutCropStage();
  drawCropStage();
  updateCropReadout();
}

function closeCropEditor() {
  $('cropModal').classList.add('hidden');
  _cropEdit.mode = 'none';
  /* Jika user mengubah skala OCR lalu menutup editor TANPA Terapkan, sinkronkan
     pipeline (stage 3 + info) — storage sudah berisi nilai baru, tampilan harus ikut. */
  if (currentBlob && !_inProcessBlob) {
    processBlob(currentBlob, currentName, _lastManualCrop, true);
  }
}

/* BATAL (ESC / tombol Batal): tutup editor TANPA menerapkan seleksi — kembalikan
   seleksi ke kondisi sebelum editor dibuka dan JANGAN re-render pipeline (pipeline
   belum berubah → instant, tidak lemot). */
function cancelCropEditor() {
  $('cropModal').classList.add('hidden');
  _cropEdit.mode = 'none';
  if (_cropEdit.prevSel) {
    _cropEdit.sel = { x: _cropEdit.prevSel.x, y: _cropEdit.prevSel.y, w: _cropEdit.prevSel.w, h: _cropEdit.prevSel.h };
  }
}

/* Ukuran tampilan canvas: fit dalam area editor (zoom 1 = muat penuh) */
function layoutCropStage() {
  var cv = $('cropStageCanvas'), body = $('cropBody');
  var availW = body.clientWidth - 20;
  var availH = Math.max(220, Math.min(460, window.innerHeight * 0.5));
  var base = Math.min(availW / cv.width, availH / cv.height);
  var z = base * _cropEdit.zoom;
  cv.style.width = Math.round(cv.width * z) + 'px';
  cv.style.height = Math.round(cv.height * z) + 'px';
  $('cropZoomLabel').textContent = Math.round(_cropEdit.zoom * 100) + '%';
}

function cropCanvasPos(e) {
  var cv = $('cropStageCanvas');
  var r = cv.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * cv.width / r.width,
    y: (e.clientY - r.top) * cv.height / r.height
  };
}

function drawCropStage() {
  var cv = $('cropStageCanvas');
  var ctx = cv.getContext('2d');
  ctx.drawImage(_cropEdit.img, 0, 0);
  var s = _cropEdit.sel;
  /* Gelapkan area di luar pilihan */
  ctx.fillStyle = 'rgba(8,11,20,0.5)';
  ctx.fillRect(0, 0, cv.width, s.y);
  ctx.fillRect(0, s.y + s.h, cv.width, cv.height - s.y - s.h);
  ctx.fillRect(0, s.y, s.x, s.h);
  ctx.fillRect(s.x + s.w, s.y, cv.width - s.x - s.w, s.h);
  /* Bingkai + handle */
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3;
  ctx.strokeRect(s.x, s.y, s.w, s.h);
  var hz = 8;
  ctx.fillStyle = '#f59e0b';
  [[s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h]].forEach(function(p) {
    ctx.fillRect(p[0] - hz / 2, p[1] - hz / 2, hz, hz);
  });
  var label = Math.round(s.w) + '×' + Math.round(s.h);
  ctx.font = 'bold 15px Consolas, monospace';
  var tw = ctx.measureText(label).width;
  var lx = Math.min(Math.max(s.x + s.w / 2 - tw / 2, 4), cv.width - tw - 8);
  var ly = Math.max(s.y - 12, 24);
  ctx.fillStyle = 'rgba(8,11,20,0.85)';
  ctx.fillRect(lx - 6, ly - 16, tw + 12, 22);
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1;
  ctx.strokeRect(lx - 6, ly - 16, tw + 12, 22);
  ctx.fillStyle = '#f59e0b';
  ctx.fillText(label, lx, ly);
}

function cropHitTest(p) {
  var s = _cropEdit.sel;
  /* Radius hit-test mengikuti zoom tampilan: 12px di layar → dalam piksel canvas */
  var cv = $('cropStageCanvas');
  var displayScale = cv.getBoundingClientRect().width / cv.width;
  var hz = 12 / Math.max(0.05, displayScale);
  var near = function(a, b) { return Math.abs(a - b) <= hz; };
  if (near(p.x, s.x) && near(p.y, s.y)) return 'nw';
  if (near(p.x, s.x + s.w) && near(p.y, s.y)) return 'ne';
  if (near(p.x, s.x) && near(p.y, s.y + s.h)) return 'sw';
  if (near(p.x, s.x + s.w) && near(p.y, s.y + s.h)) return 'se';
  if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) return 'move';
  return 'draw';
}

function clampCrop() {
  var s = _cropEdit.sel;
  var w = _cropEdit.img.width, h = _cropEdit.img.height;
  var MIN = 24;
  s.w = Math.max(MIN, Math.round(s.w));
  s.h = Math.max(MIN, Math.round(s.h));
  s.x = Math.max(0, Math.min(Math.round(s.x), w - s.w));
  s.y = Math.max(0, Math.min(Math.round(s.y), h - s.h));
  /* Batas ATAS: jangan biarkan seleksi lebih besar dari gambar
     (terjadi saat sudut ditarik melewati tepi canvas). */
  s.w = Math.min(s.w, w - s.x);
  s.h = Math.min(s.h, h - s.y);
  s.w = Math.max(MIN, s.w);
  s.h = Math.max(MIN, s.h);
}

function updateCropReadout() {
  var s = _cropEdit.sel, w = _cropEdit.img.width, h = _cropEdit.img.height;
  /* Zoom OCR dari area ini — persis isCrop di produksi (cap Perbesaran OCR), pakai helper yang sama */
  var prep = computePrepInfo(s.w, s.h, true, _cropScale);
  var scale = prep.scale, dpi = prep.dpi, sw2 = prep.sw2, sh2 = prep.sh2;
  var cells = [
    { k: 'Area dipilih', v: Math.round(s.x) + ', ' + Math.round(s.y) + ' → ' + Math.round(s.w) + '×' + Math.round(s.h) },
    { k: '% dari gambar asli', v: Math.round((s.w * s.h) / (w * h) * 100) + '%' },
    { k: 'Perbesaran (zoom)', v: '×' + scale.toFixed(2) + ' dari asli' },
    { k: 'DPI', v: String(dpi) },
    { k: 'Ukuran setelah zoom', v: sw2 + '×' + sh2 },
    { k: 'Canvas → Tesseract', v: prep.finalW + '×' + prep.finalH }
  ];
  var html = '<div class="sz-grid">';
  cells.forEach(function(c) { html += '<div class="sz-cell"><b>' + c.k + '</b><span>' + c.v + '</span></div>'; });
  html += '</div>';
  $('cropReadout').innerHTML = html;
  updateCropPrompt(s, scale, dpi, sw2, sh2);
}

/* Kata-kata prompt dari hasil crop manual + zoom */
function updateCropPrompt(s, scale, dpi, sw2, sh2) {
  var PAD = 2; /* padding 2px di semua sisi (border putih) — dipilih user (sebelumnya 0, dikembalikan) */
  /* Preprocessing sesuai pilihan PANEL (default mati) — prompt mengikuti toggle aktif */
  var applied = preprocApplied();
  var prepPhrase = applied.length
    ? 'terapkan preprocessing: ' + applied.join(' + ')
    : 'tanpa preprocessing (semua tahap dimatikan)';
  var lines = [
    'INSTRUKSI OCR — AREA MANUAL',
    '',
    'Screenshot asli: ' + _cropEdit.img.width + '×' + _cropEdit.img.height + ' px',
    'Area OCR: x=' + Math.round(s.x) + ', y=' + Math.round(s.y) + ', lebar ' + Math.round(s.w) + ', tinggi ' + Math.round(s.h) + ' px (' + Math.round((s.w * s.h) / (_cropEdit.img.width * _cropEdit.img.height) * 100) + '% dari gambar)',
    'Perbesaran zoom: ×' + scale.toFixed(2) + ' dari gambar asli (DPI ' + dpi + ')',
    'Ukuran yang diproses: ' + sw2 + '×' + sh2 + ' px (canvas ' + (sw2 + PAD * 2) + '×' + (sh2 + PAD * 2) + ' dengan padding 2 px)',
    'Preprocessing: ' + (applied.length ? applied.join(' + ') : 'tanpa preprocessing (semua dimatikan)'),
    '',
    'PROMPT:',
    '"Lakukan OCR hanya pada area yang ditandai pada gambar asli: kotak x=' + Math.round(s.x) + ', y=' + Math.round(s.y) + ' dengan lebar ' + Math.round(s.w) + ' dan tinggi ' + Math.round(s.h) + ' piksel. Perbesar area tersebut ' + scale.toFixed(2) + '× dari gambar asli, ' + prepPhrase + '. Baca seluruh teks di dalam area itu, terutama kode tiket dan user ID."'
  ];
  $('cropPrompt').value = lines.join('\n');
}

/* ---- Interaksi editor: mousedown/mousemove/mouseup ---- */
$('cropStageCanvas').addEventListener('mousedown', function(e) {
  if (!_cropEdit.img) return;
  e.preventDefault();
  var p = cropCanvasPos(e);
  _cropEdit.mode = cropHitTest(p);
  _cropEdit.start = p;
  _cropEdit.orig = { x: _cropEdit.sel.x, y: _cropEdit.sel.y, w: _cropEdit.sel.w, h: _cropEdit.sel.h };
  if (_cropEdit.mode === 'draw') {
    _cropEdit.sel = { x: p.x, y: p.y, w: 1, h: 1 };
  }
});
window.addEventListener('mousemove', function(e) {
  if (_cropEdit.mode === 'none' || !_cropEdit.img) return;
  e.preventDefault();
  var p = cropCanvasPos(e);
  var s = _cropEdit.sel, o = _cropEdit.orig, st = _cropEdit.start;
  if (_cropEdit.mode === 'draw') {
    s.x = Math.min(st.x, p.x); s.y = Math.min(st.y, p.y);
    s.w = Math.abs(p.x - st.x); s.h = Math.abs(p.y - st.y);
  } else if (_cropEdit.mode === 'move') {
    s.x = o.x + (p.x - st.x); s.y = o.y + (p.y - st.y);
  } else {
    var x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    if (_cropEdit.mode.indexOf('w') >= 0) x1 = Math.min(p.x, x2 - 24);
    if (_cropEdit.mode.indexOf('e') >= 0) x2 = Math.max(p.x, x1 + 24);
    if (_cropEdit.mode.indexOf('n') >= 0) y1 = Math.min(p.y, y2 - 24);
    if (_cropEdit.mode.indexOf('s') >= 0) y2 = Math.max(p.y, y1 + 24);
    s.x = x1; s.y = y1; s.w = x2 - x1; s.h = y2 - y1;
  }
  clampCrop();
  scheduleCropRender();
});
window.addEventListener('mouseup', function() {
  if (_cropEdit.mode !== 'none') { _cropEdit.mode = 'none'; }
});

/* Redraw editor maksimal 1× per frame (requestAnimationFrame) — dragging tidak
   lagi menggambar ulang canvas penuh + readout setiap mousemove (penyebab lemot). */
var _cropRenderRaf = 0;
function scheduleCropRender() {
  if (_cropRenderRaf) return;
  _cropRenderRaf = requestAnimationFrame(function() {
    _cropRenderRaf = 0;
    drawCropStage();
    updateCropReadout();
  });
}

/* ---- Tombol editor ---- */
$('cropZoomIn').addEventListener('click', function() { _cropEdit.zoom = Math.min(4, _cropEdit.zoom * 1.3); layoutCropStage(); });
$('cropZoomOut').addEventListener('click', function() { _cropEdit.zoom = Math.max(0.25, _cropEdit.zoom / 1.3); layoutCropStage(); });
/* Perbesaran OCR — zoom maksimal area crop; disimpan ke storage agar engine produksi ikut. */
$('cropScaleInput').addEventListener('input', function() {
  var v = parseFloat(this.value);
  if (isNaN(v)) return;
  _cropScale = Math.min(4, Math.max(1.0, v)); /* min ×1.0 (instruksi user) */
  saveCropScale();
  if (_cropEdit && _cropEdit.img && _cropEdit.sel) updateCropReadout();
});
$('cropScaleInput').addEventListener('blur', function() {
  if (isNaN(parseFloat(this.value))) this.value = _cropScale.toFixed(2);
});
$('cropClose').addEventListener('click', closeCropEditor);
$('cropCancel').addEventListener('click', cancelCropEditor);
/* Tombol ESC = BATAL (instruksi user): tutup editor tanpa menerapkan seleksi. */
window.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && !$('cropModal').classList.contains('hidden')) cancelCropEditor();
});
$('cropApply').addEventListener('click', function() {
  var s = _cropEdit.sel;
  var mc = { cx: Math.round(s.x), cy: Math.round(s.y), cw: Math.round(s.w), ch: Math.round(s.h) };
  /* closeCropEditor dipanggil DI DALAM processBlob (dengan flag _inProcessBlob) →
     tidak terjadi double render */
  if (currentBlob) {
    /* Crop diterapkan → pipeline dirender ulang TANPA auto-search (auto hanya
       berjalan saat tombol 🤖 diklik — instruksi user). */
    processBlob(currentBlob, currentName, mc);
  }
});
/* Terapkan crop manual terakhir ke gambar baru yang berukuran sama.
   Guard: jika tombol belum ada di DOM (HTML lama / belum reload penuh),
   JANGAN sampai mematikan wiring lain (termasuk tombol OCR) di blok yang sama. */
var _reuseBtn = $('btnReuseCrop');
if (_reuseBtn) _reuseBtn.addEventListener('click', function() {
  if (!currentBlob || !_storedManualCrop) return;
  /* Pakai crop terakhir → pipeline dirender ulang TANPA auto-search (auto hanya
     berjalan saat tombol 🤖 diklik — instruksi user). */
  processBlob(currentBlob, currentName, _storedManualCrop);
});
$('cropCopy').addEventListener('click', function() {
  var ta = $('cropPrompt');
  ta.select(); ta.setSelectionRange(0, 999999);
  var btn = this;
  var done = function() {
    var old = btn.textContent;
    btn.textContent = '✓ Tersalin!'; btn.style.background = 'rgba(34,197,94,0.2)';
    setTimeout(function() { btn.textContent = old; btn.style.background = ''; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done).catch(function() { done(); });
  } else { done(); }
});

/* =====================================================================
 * 6) LIGHTBOX ZOOM 1:1
 * ===================================================================== */
function openLightbox(canvas, caption) {
  var lb = $('lightbox'), lbc = $('lbCanvas');
  lbc.width = canvas.width; lbc.height = canvas.height;
  lbc.getContext('2d').drawImage(canvas, 0, 0);
  $('lbCaption').textContent = caption + ' — ukuran asli ' + canvas.width + '×' + canvas.height + ' (scroll untuk melihat, klik untuk tutup)';
  lb.classList.remove('hidden');
}
$('lightbox').addEventListener('click', function() { this.classList.add('hidden'); });

/* =====================================================================
 * 7) INPUT: file, drag-drop, paste
 * ===================================================================== */
$('fileInput').addEventListener('change', function(e) {
  var f = e.target.files && e.target.files[0];
  if (f) processBlob(f, f.name);
});

var dragCount = 0;
window.addEventListener('dragenter', function(e) { e.preventDefault(); dragCount++; $('dropHint').classList.remove('hidden'); });
window.addEventListener('dragleave', function(e) { e.preventDefault(); if (--dragCount <= 0) { dragCount = 0; $('dropHint').classList.add('hidden'); } });
window.addEventListener('dragover', function(e) { e.preventDefault(); });
window.addEventListener('drop', function(e) {
  e.preventDefault(); dragCount = 0;
  $('dropHint').classList.add('hidden');
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && f.type && f.type.indexOf('image/') === 0) processBlob(f, f.name);
});

window.addEventListener('paste', function(e) {
  var items = (e.clipboardData && e.clipboardData.items) || [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image/') === 0) {
      var f = items[i].getAsFile();
      if (f) { processBlob(f, 'clipboard'); return; }
    }
  }
});

/* =====================================================================
 * 8) WIRING
 * ===================================================================== */

$('chkOverlay').addEventListener('change', renderStage1);

/* ---- Toggle preprocessing (panel pilihan) — re-render pipeline dengan pilihan baru ---- */
function renderWithPreproc() {
  if (currentBlob) return processBlob(currentBlob, currentName, _lastManualCrop, true);
  return Promise.resolve();
}
PREPROC_KEYS.forEach(function(k) {
  var btn = $('pp' + k.charAt(0).toUpperCase() + k.slice(1));
  if (!btn) return;
  btn.addEventListener('click', function() {
    applyPreprocToggle(k, !preprocOpts[k]);
    renderWithPreproc();
  });
});
var ppReset = $('ppReset');
if (ppReset) ppReset.addEventListener('click', function() {
  setAllPreproc(false);
  renderWithPreproc();
});
setAllPreproc(false); /* sinkron kelas tombol ke default mati */
$('szW').addEventListener('input', renderSizeGuide);
$('szH').addEventListener('input', renderSizeGuide);
document.querySelectorAll('#sizePanel .sz-presets button').forEach(function(b) {
  b.addEventListener('click', function() {
    $('szW').value = b.dataset.w;
    $('szH').value = b.dataset.h;
    renderSizeGuide();
  });
});
renderSizeGuide();

$('btnOcr').addEventListener('click', runOcr);
var btnAuto = $('btnAuto');
if (btnAuto) btnAuto.addEventListener('click', autoSearchBest);
/* Klik gambar hasil akhir pemenang → zoom lightbox */
var autoResultImg = $('autoResultImg');
if (autoResultImg) autoResultImg.addEventListener('click', function() {
  if (autoResultImg.width > 0) openLightbox(autoResultImg, '🏆 Hasil Akhir Pemenang (auto-search)');
});
var autoCopyBtn = $('autoCopy');
if (autoCopyBtn) autoCopyBtn.addEventListener('click', function() {
  var ta = $('autoPrompt');
  if (!ta || !ta.value) return;
  ta.select(); ta.setSelectionRange(0, 999999);
  var btn = this;
  var done = function() {
    var old = btn.textContent;
    btn.textContent = '✓ Tersalin!'; btn.style.background = 'rgba(34,197,94,0.2)';
    setTimeout(function() { btn.textContent = old; btn.style.background = ''; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done).catch(function() { done(); });
  } else { done(); }
});

/* OCR asli hanya tersedia di konteks extension */
if (!isExtension()) {
  $('ocrPanel').style.display = 'none';
}

/* Demo awal: tunggu skala OCR dari storage dulu agar pipeline langsung memakai
   zoom yang tersimpan (bukan default 1.5 yang basi). */
loadCropScale().then(function() {
  loadDemoCanvas(drawAdminLandscape(1920, 1080), 'contoh 1920×1080 (bersih)');
});
