/* =====================================================================
 * OCR BRIDGE — Menerima request dari OCR Frame, proses di Dashboard
 *
 * Modul ini:
 * 1. Mendeteksi request OCR dari chrome.storage (_ocrBridgeReq_*)
 * 2. Untuk mode 'codes': delegasi ke detectFromImage (dari dashboard)
 * 3. Untuk mode 'all': proses OCR tanpa whitelist (NAMA/RRN)
 * 4. Simpan hasil ke _ocrBridgeRes_{reqId}
 * ===================================================================== */

import { sharpen, enhanceContrast, dilateGray, calculateOptimalScale, findBlankCut, splitCanvasV } from './ocr-common.js';

/* ---- Inisialisasi: daftarkan listener saat modul di-load ---- */
initBridge();

function initBridge() {
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
      // Hapus request key agar tidak diproses ulang
      chrome.storage.local.remove(key);

      if (reqData.mode === 'all') {
        // Mode NAMA/RRN: OCR tanpa whitelist
        processBridgeAllText(reqData.url, reqId);
      } else {
        // Mode kode tiket: pakai detectFromImage dari dashboard
        processBridgeCodes(reqData.url, reqId, reqData.originalUrl || reqData.url);
      }
    }
  });
}

/* ---- Mode kode tiket: delegasi ke detectFromImage dashboard ---- */
function processBridgeCodes(url, reqId, originalUrl) {
  var resultKey = '_ocrBridgeRes_' + reqId;

  var fn = typeof window._bridgeDetectFromImage === 'function' ? window._bridgeDetectFromImage : null;
  if (!fn) {
    // Dashboard belum siap atau detectFromImage belum terekspos
    chrome.storage.local.set({
      [resultKey]: {
        codes: [], error: 'Dashboard OCR belum siap', lines: [],
        varLines: [], varRawLines: [], var0Lines: [], passages: [], allRaw: '', elapsed: ''
      }
    });
    return;
  }

  // Konversi data URL ke blob URL (detectFromImage hanya terima http: dan blob:)
  if (url.indexOf('data:') === 0) {
    dataUrlToBlob(url).then(function(blob) {
      if (!blob) {
        chrome.storage.local.set({
          [resultKey]: { codes: [], error: 'Gagal konversi data URL', lines: [],
            varLines: [], varRawLines: [], var0Lines: [], passages: [], allRaw: '', elapsed: '' }
        });
        return;
      }
      // Buat blob URL agar detectFromImage bisa menerimanya
      var blobUrl = URL.createObjectURL(blob);
      runDetect(fn, blobUrl, reqId, resultKey, originalUrl, blob);
    });
  } else {
    runDetect(fn, url, reqId, resultKey, originalUrl);
  }
}

function runDetect(fn, url, reqId, resultKey, originalUrl, blob) {
  // Pool 2 = silent worker pool khusus LiveChat, terpisah dari scan slot dashboard agar tidak antre
  fn(url, -1, 2, true, blob).then(function(result) {
    if (!result) {
      chrome.storage.local.set({
        [resultKey]: { codes: [], error: 'Gagal OCR', lines: [],
          varLines: [], varRawLines: [], var0Lines: [], passages: [], allRaw: '', elapsed: '' }
      });
      return;
    }

    // Format result agar kompatibel dengan OCR Frame
    var passages = result.passages || [];
    var varLines = passages.map(function(p) { return p.lines || []; });
    var var0Lines = passages.length > 0 && passages[0].lines ? passages[0].lines : [];

    chrome.storage.local.set({
      [resultKey]: {
        codes: result.codes || [],
        codeInfo: result.codeInfo || {},
        bestCodes: result.bestCodes || [],
        lines: result.lines || [],
        varLines: varLines,
        varRawLines: varLines,
        var0Lines: var0Lines,
        passages: passages,
        elapsed: result.elapsed || '',
        allRaw: result.allRaw || '',
        error: result.error || ''
      }
    });
  }).catch(function(err) {
    chrome.storage.local.set({
      [resultKey]: { codes: [], error: err.message || 'Gagal OCR', lines: [],
        varLines: [], varRawLines: [], var0Lines: [], passages: [], allRaw: '', elapsed: '' }
    });
  });
}

/* ---- Mode NAMA/RRN: OCR tanpa whitelist ---- */
/* Dua varian PARALEL (pola asli): PSM 6 (blok tunggal) + PSM 3 (auto, baca
   semua blok). Model best untuk akurasi digit. */
var ALL_VARIANTS = [
  { label: 'all ps6', prep: 'dilated', psm: '6', whitelist: '', engine: '1', dpi: 200 },
  { label: 'all ps3', prep: 'dilated', psm: '3', whitelist: '', engine: '1', dpi: 200 },
];
var CHUNK_HEIGHT = 2500; /* potret HP tinggi → irisan vertikal */
var _bridgeWorkers = [];
var _bridgeScanCount = 0;

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
      var id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Adaptive binarization + sharpen
      for (var i = 0; i < id.data.length; i += 4) {
        var g = (0.299 * id.data[i] + 0.587 * id.data[i+1] + 0.114 * id.data[i+2]) | 0;
        id.data[i] = id.data[i+1] = id.data[i+2] = g;
      }
      // Simple Otsu threshold
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

async function initBridgeWorkers() {
  if (_bridgeWorkers.length >= ALL_VARIANTS.length) return;
  // Recycle every 30 scans
  _bridgeScanCount++;
  if (_bridgeScanCount >= 30) {
    for (var rci = 0; rci < _bridgeWorkers.length; rci++) {
      try { _bridgeWorkers[rci].terminate().catch(function() {}); } catch(e) {}
    }
    _bridgeWorkers.length = 0;
    _bridgeScanCount = 0;
  }
  var needed = ALL_VARIANTS.length - _bridgeWorkers.length;
  if (needed <= 0) return;
  var T = window.Tesseract;
  if (!T) { console.warn('ocr-bridge: Tesseract not loaded'); return; }
  var base = chrome.runtime.getURL('lib/');
  var promises = [];
  for (var i = 0; i < needed; i++) {
    promises.push(T.createWorker('eng', undefined, {
      workerPath: base + 'worker-shim.js', corePath: base, langPath: base + 'best/',
      gzip: false, workerBlobURL: false, cacheMethod: 'none', logger: function(){}
    }));
  }
  var newWorkers = await Promise.all(promises);
  for (var i = 0; i < newWorkers.length; i++) _bridgeWorkers.push(newWorkers[i]);
}

function processBridgeAllText(url, reqId) {
  var resultKey = '_ocrBridgeRes_' + reqId;
  var t0 = Date.now();

  (async function() {
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

      // Preprocessing: scale + contrast + sharpen
      var img;
      try {
        img = await createImageBitmap(_blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      } catch(e) {
        var prepped = await preprocessImage(_blob);
        // Fallback: use preprocessed canvas directly
        var fallbackCanvas = prepped;
        await initBridgeWorkers();
        if (!_bridgeWorkers.length || !_bridgeWorkers[0]) throw new Error('Worker not available');
        var rawResult = await _bridgeWorkers[0].recognize(fallbackCanvas, {
          tessedit_pageseg_mode: '6', tessedit_ocr_engine_mode: '1', tessedit_enable_doc_dict: '0'
        });
        var rawText = rawResult.data.text || '';
        var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        var cleaned = rawText.replace(/[^a-zA-Z0-9.,'"]/g, ' ').replace(/\s+/g, ' ').trim();
        chrome.storage.local.set({
          [resultKey]: {
            text: cleaned, allRaw: rawText, lines: cleaned.split('\n').filter(Boolean),
            elapsed: elapsed, error: ''
          }
        });
        return;
      }

      var calc = calculateOptimalScale(img.width, img.height);
      var scale = calc.scale;
      var maxPixels = 5000000;
      var maxScalePixels = Math.sqrt(maxPixels / (img.width * img.height));
      if (scale > maxScalePixels) scale = maxScalePixels;

      var sw = Math.round(img.width * scale);
      var sh = Math.round(img.height * scale);
      var PAD = 2; /* padding 2px di semua sisi (border putih) — dipilih user (sebelumnya 0, sekarang dikembalikan) */
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
      if (Math.max(origW, origH) > 1400) dilateGray(id, 2);
      enhanceContrast(id, 0.01);
      sharpen(id);
      ctx.putImageData(id, 0, 0);

      await initBridgeWorkers();
      if (!_bridgeWorkers.length) throw new Error('Worker not available');

      var canvases = [canvas];
      var results = [];

      /* ---- Pass utama (pola asli): kedua varian PARALEL di 2 worker ---- */
      function _runVariant(idx, worker, cv) {
        var v = ALL_VARIANTS[idx];
        /* DPI multiplier 1.1× untuk PSM 6/7 (konsisten dengan ocr-engine) */
        /* DPI = 96×scale — canvas sudah optimal, DPI lebih tinggi hanya menambah beban komputasi */
        var useDpi = Math.round(96 * scale);
        return worker.recognize(cv, {
          tessedit_pageseg_mode: v.psm, tessedit_ocr_engine_mode: v.engine,
          tessedit_enable_doc_dict: '0', load_system_dawg: '0', load_freq_dawg: '0',
          user_defined_dpi: String(useDpi)
        }).then(function(r) { return { variant: v, text: r.data.text || '' }; });
      }
      var isTall = canvas.height > CHUNK_HEIGHT;
      if (isTall) {
        /* Potret tinggi: irisan PSM 6 di-PARALELKAN di kedua worker (irisan i →
           worker i%2). Tidak ada full pass — irisan sudah menutupi seluruh gambar.
           Fallback full PSM 3 hanya bila irisan hampir tidak menghasilkan teks. */
        try {
          var nChunksAll = Math.max(2, Math.ceil(canvas.height / CHUNK_HEIGHT));
          var _chunksAll = splitCanvasV(canvas, nChunksAll);
          var _chunkAllJobs = [];
          for (var _cai = 0; _cai < _chunksAll.length; _cai++) {
            (function(_ca, _ci2) {
              var _w2 = _bridgeWorkers[_ci2 % 2] || _bridgeWorkers[0];
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
                return { variant: ALL_VARIANTS[0], text: '' };
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
          try { results.push(await _runVariant(1, _bridgeWorkers[1] || _bridgeWorkers[0], canvas)); } catch(e) {}
        }
      } else {
        var allPasses = [];
        for (var avi = 0; avi < ALL_VARIANTS.length; avi++) {
          allPasses.push(_runVariant(avi, _bridgeWorkers[avi] || _bridgeWorkers[0], canvases[0]));
        }
        var settledAll = await Promise.all(allPasses);
        for (var ai = 0; ai < settledAll.length; ai++) results.push(settledAll[ai]);
      }

      // Free canvas
      canvas.width = 0; canvas.height = 0;

      var allRaw = '';
      /* GABUNGKAN SEMUA chunk (sebelumnya hanya teks chunk TERPANJANG — isi
         chunk lain HILANG → "tidak semua terOCR" untuk NAMA/RRN potret tinggi). */
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

      // Filter: hanya huruf, angka, ., , , ' "
      var mergedText = mergedLines.join('\n');

      var cleaned = mergedText.replace(/[^a-zA-Z0-9.,'"]/g, ' ').replace(/\s+/g, ' ').trim();
      var elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      chrome.storage.local.set({
        [resultKey]: {
          text: cleaned, allRaw: allRaw, lines: cleaned.split('\n').filter(Boolean),
          elapsed: elapsed, error: ''
        }
      });

    } catch(err) {
      chrome.storage.local.set({
        [resultKey]: { text: '', error: err.message || 'Gagal OCR', lines: [], allRaw: '', elapsed: '' }
      });
    }
  })();
}

/* ---- Utility: data URL → Blob ---- */
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
