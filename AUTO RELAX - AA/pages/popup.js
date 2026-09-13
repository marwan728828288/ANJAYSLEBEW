import { $, $$, getData, setData, showToast, parseUser, cleanKode, validPanjangKode, escapeHtml, generatePassword, resetCekBet, resetBonus, uncheckAll, getSelectedIds, updateBulkInfo, state } from '../modules/shared.js';
import { getTokens, extractCodes, getAllBestCodes, sharpen, enhanceContrast, adaptiveDilate, removeSpecks, calculateOptimalScale, findBlankCut, splitCanvasV } from '../modules/ocr-common.js';

let isDualMode = false;
let scanSelections = [];

async function renderLiteData() {
  const result = await getData('rows');
  const rows = result.rows || [];
  const tbody = $('#lite-table-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="7">Belum ada data</td></tr>';
    updateStats(rows);
    return;
  }
  const reversed = rows.slice().reverse().slice(0, 50);
  let html = '';
  for (const r of reversed) {
    const ds = r.autoStatus || r.manualStatus || '';
    const rowClass = ds === 'Ticket Not Found' || ds === 'Session Timeout' ? 'row-notfound' : ds === 'Approved' ? 'row-approved' : '';
    const bonusVal = r.secureStatus === 'SUCCESS' ? '✔' : r.secureStatus === 'FAILED' ? '✖' : r.secureStatus || '-';
    html += '<tr class="' + rowClass + '" data-id="' + r.id + '">';
    html += '<td><input type="checkbox" class="bulk-cb" value="' + r.id + '" style="width:12px;height:12px;accent-color:#818cf8;" tabindex="-1"></td>';
    html += '<td>' + escapeHtml(r.user) + (r.hasTS ? ' <span style="color:#fcd34d;font-size:8px;">TS</span>' : '') + '</td>';
    html += '<td style="font-family:monospace;font-size:9px;">' + escapeHtml(r.kodeTiket || r.kode || r.kode2 || '') + '</td>';
    html += '<td>' + (ds ? '<span class="badge ' + (ds === 'Approved' ? 'badge-success' : ds === 'Ticket Not Found' || ds === 'Session Timeout' ? 'badge-danger' : 'badge-warning') + '">' + escapeHtml(ds) + '</span>' : '<span class="badge badge-muted">Baru</span>') + '</td>';
    html += '<td style="font-size:9px;color:#9ca3af;max-width:120px;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(r.keterangan || r.betting || '') + '</td>';
    html += '<td style="font-size:11px;">' + bonusVal + '</td>';
    html += '<td><div class="actions">';
    html += '<button class="btn btn-sm btn-info btn-edit" data-id="' + r.id + '" tabindex="-1">Edit</button>';
    html += '<button class="btn btn-sm btn-warning btn-retry-cekbet" data-id="' + r.id + '" tabindex="-1">Cek</button>';
    html += '<button class="btn btn-sm btn-success btn-retry-bonus" data-id="' + r.id + '" tabindex="-1">Bonus</button>';
    html += '<button class="btn btn-sm btn-danger btn-delete" data-id="' + r.id + '" tabindex="-1">Hapus</button>';
    html += '</div></td>';
    html += '</tr>';
  }
  tbody.innerHTML = html;
  updateStats(rows);
}

function updateStats(rows) {
  const total = rows.length;
  const approved = rows.filter(function(r) { return r.autoStatus === 'Approved' || r.manualStatus === 'Approved'; }).length;
  const rejected = rows.filter(function(r) { return r.autoStatus === 'Ticket Not Found' || r.autoStatus === 'Session Timeout' || r.manualStatus === 'Ticket Not Found' || r.manualStatus === 'Session Timeout' || r.autoCol10 === 'Tidak Ditemukan Scatter' || r.autoCol10 === 'Scatter Not Found'; }).length;
  const pending = total - approved - rejected;
  $('#stat-total').textContent = total;
  $('#stat-approved').textContent = approved;
  $('#stat-rejected').textContent = rejected;
  $('#stat-pending').textContent = pending;
}

async function liteAddRow(user, kode, kode2) {
  if (!user || !kode) { showToast('User ID dan Kode Tiket wajib diisi', true); return; }
  const parsed = parseUser(user);
  const kodeClean = cleanKode(kode);
  const kode2Clean = kode2 ? cleanKode(kode2) : '';
  if (!validPanjangKode(kodeClean)) { showToast('Kode Tiket minimal 19 karakter', true); return; }
  if (kode2Clean && !validPanjangKode(kode2Clean)) { showToast('Kode Tiket 2 minimal 19 karakter', true); return; }
  const result = await getData(['rows', 'nextRowId']);
  let rows = result.rows || [];
  let nextId = result.nextRowId || 1;
  const base = {
    user: parsed.user,
    hasTS: parsed.hasTS,
    autoStatus: '', manualStatus: '', betting: '', payout: '',
    keterangan: '', secureStatus: '',
    createdAt: Date.now(), updatedAt: Date.now(), source: 'lite'
  };
  var addedIds = [];
  function tryAdd(kt, label) {
    if (!kt) return;
    const exist = rows.some(function(r) { return (r.kodeTiket || r.kode) === kt; });
    if (exist) {
      $('#status-text').textContent = label + ' sudah ada!';
      $('#status-text').className = 'dup';
      showToast(label + ' sudah ada dalam data', true);
      return false;
    }
    var newId = nextId++;
    rows.push({ id: newId, kodeTiket: kt, ...base });
    addedIds.push(newId);
    return true;
  }
  if (!tryAdd(kodeClean, 'Kode Tiket')) return;
  if (kode2Clean) { tryAdd(kode2Clean, 'Kode Tiket 2'); }
  await setData({ rows: rows, nextRowId: nextId });
  $('#status-text').textContent = 'Data tersimpan!';
  $('#status-text').className = '';
  $('#lite-user').value = '';
  $('#lite-kode').value = '';
  if ($('#lite-kode-2')) $('#lite-kode-2').value = '';
  scanSelections = [];
  chrome.storage.local.remove(['scanResult', 'formState']);
  var ss = $('#scan-status');
  if (ss) { ss.textContent = ''; ss.className = ''; }
  var su = $('#scan-url');
  if (su) { su.value = ''; su.dispatchEvent(new Event('input', { bubbles: true })); }
  showToast('Data berhasil ditambahkan');
  renderLiteData();
  if (addedIds.length) {
    /* Auto-check history berjalan via countdown 60 detik, tidak langsung. */
    chrome.runtime.sendMessage({ type: 'TRIGGER_MANUAL', priorityIds: addedIds.slice() });
  }
}

var _pasteStart = 0;

async function detectFromImage(url) {
  if (!url.startsWith('http')) { $('#scan-status').textContent = 'URL tidak valid'; $('#scan-status').className = 'scan-err'; return; }
  var scanStart = _pasteStart || Date.now();
  $('#scan-status').textContent = 'Mengunduh...';
  $('#scan-status').className = '';
  var _blob;
  try {
    var imgResp = await fetch(url, { mode: 'cors' });
    if (!imgResp.ok) throw new Error('HTTP ' + imgResp.status);
    _blob = await imgResp.blob();
  } catch (e) {
    var msg = 'Gagal';
    try { var em = String(e.message || e); if (em.indexOf('404') >= 0) msg = 'Gambar tidak ditemukan'; else if (em.indexOf('HTTP') >= 0 || em.indexOf('fetch') >= 0) msg = 'Gagal unduh'; else msg = 'Gagal diproses'; } catch (_) { msg = 'Gagal'; }
    $('#scan-status').textContent = msg; $('#scan-status').className = 'scan-err'; return;
  }



  var allCodeMap = {}, allLines = [], allRaw = '';
  var allVariants = [
    /* HANYA PSM 3 (fully automatic, baca SEMUA blok) — sinkron dengan VARIANTS di
       ocr-engine.js (dipilih user). Model best agar digit tidak tertukar. */
    { label: 'dil ps3', prep: 'dilated', psm: '3', whitelist: '0123456789+', engine: '1', dpi: 200 },
  ];
  var CHUNK_HEIGHT = 2500; /* potret HP tinggi → irisan vertikal */
  var prepCache = {};
  var prepDpiMap = {};

  async function getPrep(name) {
    if (prepCache[name]) return prepCache[name];
    prepCache[name] = (async function() {
      var img;
      try { img = await createImageBitmap(_blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); } catch(e) { return _blob; }
      // Auto-crop: landscape 1920×1080 → crop center 600×1080
      if (img.width === 1920 && img.height === 1080) {
        var cropCanvas = document.createElement('canvas');
        cropCanvas.width = 600; cropCanvas.height = 1080;
        cropCanvas.getContext('2d').drawImage(img, 660, 0, 600, 1080, 0, 0, 600, 1080);
        img.close();
        var cropBlob = await new Promise(function(res) { cropCanvas.toBlob(res, 'image/png'); });
        img = await createImageBitmap(cropBlob);
      }
      var calc = calculateOptimalScale(img.width, img.height);
      var scale = calc.scale;
      // --- Pixel cap 5 MP ---
      var maxPixels = 5000000;
      var maxScalePixels = Math.sqrt(maxPixels / (img.width * img.height));
      if (scale > maxScalePixels) scale = maxScalePixels;
      prepDpiMap[name] = Math.round(96 * scale);
      var sw = Math.round(img.width * scale);
      var sh = Math.round(img.height * scale);
      var PAD = 2; // padding 2px di semua sisi (border putih) — dipilih user (sebelumnya 0, dikembalikan)
      // Reuse small shared canvas pool to reduce allocations/GC overhead
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
      // Single preprocessing: buang spek noise → dilasi adaptif → contrast → sharpen
      var id = ctx.getImageData(0, 0, c.width, c.height);
      removeSpecks(id);
      adaptiveDilate(id, srcW, srcH);
      enhanceContrast(id, 0.01); // contrast balanced
      sharpen(id);               // pertegas tepi
      ctx.putImageData(id, 0, 0);
      return c;
    })();
    return prepCache[name];
  }

  $('#scan-status').textContent = 'Memproses...';

  // Prepare all blobs in parallel
  var prepPromises = allVariants.map(function(v) { return getPrep(v.prep); });
  var canvases = await Promise.all(prepPromises);

  // Create all workers in parallel (reuse cached workers across scans)
  var T = window.Tesseract;
  var base = chrome.runtime.getURL('lib/');
  // Pin core SIMD-LSTM — auto-deteksi bisa memilih relaxedsimd yang glue/wasm-nya
  // tidak cocok di project ini (error "missing function: DotProductSSE").
  var CORE_FILE = 'tesseract-core-simd-lstm.wasm.js';
  // Model best (lib/best/) untuk scan popup — akurasi maksimal untuk semua scan.
  // Jika best gagal dimuat (traineddata belum ada), fallback ke model standar (lib/).
  async function makeWorker() {
    try {
      return await T.createWorker('eng', undefined, { workerPath: base + 'worker-shim.js', corePath: base + CORE_FILE, langPath: base + 'best/', gzip: false, workerBlobURL: false, logger: function(){} });
    } catch(e) {
      return await T.createWorker('eng', undefined, { workerPath: base + 'worker-shim.js', corePath: base + CORE_FILE, langPath: base, gzip: false, workerBlobURL: false, logger: function(){} });
    }
  }
  if (!window._popupCachedWorkers) window._popupCachedWorkers = [];
  if (!window._popupWorkerReqCount) window._popupWorkerReqCount = 0;
  // Dua worker — satu untuk pass utama, satu cadangan (chunking/fallback)
  while (window._popupCachedWorkers.length < Math.max(allVariants.length, 2)) {
    window._popupCachedWorkers.push(await makeWorker());
  }
  var workers = window._popupCachedWorkers;

  // Warmup segera — priming cache workers agar responden instant
  setTimeout(function() {
    try {
      var cw = document.createElement('canvas'); cw.width = 32; cw.height = 16;
      var ctxw = cw.getContext('2d'); ctxw.fillStyle = '#fff'; ctxw.fillRect(0,0,cw.width,cw.height); ctxw.fillStyle = '#000'; ctxw.font = '12px monospace'; ctxw.fillText('2222222222', 0, 12);
      for (var wi = 0; wi < workers.length; wi++) { if (workers[wi] && workers[wi].recognize) workers[wi].recognize(cw, { tessedit_pageseg_mode: '6' }).catch(function(){}); }
    } catch(e) {}
  }, 200);

  // ✅ MEMORY FIX: Recycle workers every 20 scans untuk prevent memory leak
  window._popupWorkerReqCount++;
  if (window._popupWorkerReqCount >= 30) {
    try {
      for (var rci = 0; rci < window._popupCachedWorkers.length; rci++) {
        window._popupCachedWorkers[rci].terminate().catch(function() {});
      }
      window._popupCachedWorkers = [];
      window._popupWorkerReqCount = 0;
    } catch(e) { console.log('Worker recycle error:', e); }
  }

  // Jalankan varian PSM 3 (tunggal)
  var results = [];
  function processResult(pr) {
    var codes = extractCodes(pr.text);
    codes.forEach(function(c) { if (!allCodeMap[c]) allCodeMap[c] = { count: 0, sources: [] }; allCodeMap[c].count++; if (allCodeMap[c].sources.indexOf(pr.variant.label)===-1) allCodeMap[c].sources.push(pr.variant.label); });
    if (codes.length > 0) { allLines = allLines.concat(pr.text.split('\n').filter(Boolean)); allRaw += '\n── ' + pr.variant.label + ' ──\n' + pr.text; }
    results.push(pr);
  }
  function runVariant(idx, worker, canvas) {
    var v = allVariants[idx];
    var dpi = prepDpiMap[v.prep] || 300;
    /* DPI = 96×scale — canvas sudah optimal, DPI lebih tinggi hanya menambah beban komputasi */
    var useDpi = dpi;
    return (worker || workers[idx]).recognize(canvas || canvases[idx], { tessedit_pageseg_mode: v.psm, tessedit_ocr_engine_mode: v.engine, tessedit_enable_doc_dict: '0', tessedit_char_whitelist: v.whitelist, user_defined_dpi: String(useDpi) }).then(function(r) {
      return { variant: v, text: r.data.text || '' };
    });
  }
  /* ---- Pass utama: varian aktif (PSM 3 — satu-satunya) di 2 worker ---- */
  var isTall = canvases[0] && canvases[0].height > CHUNK_HEIGHT;
  if (isTall) {
    /* Potret tinggi: irisan PSM 3 (auto-segmentasi, baca SEMUA blok) di-PARALELKAN
       di kedua worker (irisan i → worker i%2). PSM 3 per irisan membaca semua blok
       teks, dan irisan dipotong di baris kosong jadi tidak ada teks terbelah. */
    try {
      var nChunks = Math.max(2, Math.ceil(canvases[0].height / CHUNK_HEIGHT));
      var _chunks = splitCanvasV(canvases[0], nChunks);
      var _chunkJobs = [];
      for (var _cki = 0; _cki < _chunks.length; _cki++) {
        (function(_ck, _ci) {
          _chunkJobs.push(runVariant(allVariants.length - 1, workers[_ci % 2] || workers[0], _ck).then(function(r) {
            _ck.width = 0; _ck.height = 0;
            processResult(r);
          }).catch(function() {
            /* Satu irisan gagal jangan merusak irisan lain (Promise.all fail-fast) */
            _ck.width = 0; _ck.height = 0;
          }));
        })(_chunks[_cki], _cki);
      }
      await Promise.all(_chunkJobs);
    } catch(e) {}
    /* Fallback: irisan tidak menemukan kode → full PSM 3 (varian terakhir).
       HANYA saat ada varian berbeda yang bisa menambah (allVariants.length > 1) —
       dengan varian TUNGGAL, irisan sudah mencakup seluruh canvas (dipotong di baris
       kosong), jadi full re-read = duplikat sia-sia. */
    if (Object.keys(allCodeMap).length === 0 && allVariants.length > 1) {
      try {
        var _fbr2 = await runVariant(allVariants.length - 1, workers[1] || workers[0], canvases[1] || canvases[0]);
        processResult(_fbr2);
      } catch(e) {}
    }
  } else {
    var mainPasses = [];
    for (var mvi = 0; mvi < allVariants.length; mvi++) {
      (function(mv) {
        mainPasses.push(runVariant(mv).then(function(r) { processResult(r); }));
      })(mvi);
    }
    await Promise.all(mainPasses);
  }

  // Force lepas pixel memory semua canvas
  for (var dci = 0; dci < canvases.length; dci++) {
    if (canvases[dci]) { canvases[dci].width = 0; canvases[dci].height = 0; }
  }
  canvases = null;

  /* ---- Partial merge: tingkatkan count kode yang terpecah antar baris (sama seperti dashboard) ---- */
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

  var allCodes = Object.keys(allCodeMap);
  // Tampilkan SEMUA kode (seperti dashboard), urutkan berdasarkan count
  var displayCodes = allCodes.slice().sort(function(a, b) {
    var aConfirmed = allCodeMap[a].count >= 2 ? 100 : 0;
    var bConfirmed = allCodeMap[b].count >= 2 ? 100 : 0;
    return (bConfirmed + allCodeMap[b].count) - (aConfirmed + allCodeMap[a].count);
  });
  if ($('#scan-url').value.trim() !== url) return;

    if (displayCodes.length > 0) {
      window._scanSources = allCodeMap;
      var bestCodes = [];
      for (var pass = 0; pass < 2; pass++) {
        for (var vi = 0; vi < results.length; vi++) {
          var vLines = results[vi].text.split('\n').filter(Boolean);
          var found = getAllBestCodes(vLines, allCodes, pass === 1);
          found.forEach(function(c) {
            if (c && allCodeMap[c] && allCodeMap[c].count >= 1 && bestCodes.indexOf(c) === -1) bestCodes.push(c);
          });
        }
      }
      window._seqCount = (window._seqCount || 0) + 1;
      window._popupBestCodes = bestCodes;
      window._popupAllCodeMap = allCodeMap;
      var elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
var info = '<div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">#<b>' + window._seqCount + '</b> &middot; ' + elapsed + 's</div>';
      var btns = displayCodes.map(function(c, idx) {
        var isBest = bestCodes.indexOf(c) >= 0;
        var isPicked = scanSelections.indexOf(c) >= 0;
        var btnLabel = isPicked ? '✕' : (isBest ? '+Ambil' : 'Ambil');
        var btnBg = isPicked ? '#ef4444' : (isBest ? '#facc15' : '#22c55e');
        var btnColor = isPicked ? '#fff' : (isBest ? '#000' : '#fff');
        return '<div style="margin:2px 0;display:flex;align-items:center;"><button class="btn btn-sm scan-pick" data-code="' + c + '" style="font-family:monospace;font-size:11px;flex:1;text-align:left;padding:4px 8px;">' + (idx+1) + '. ' + c.slice(0, 16) + '<span style="font-size:20px;font-weight:bold">' + c.slice(-3) + '</span></button><span class="scan-pick-ambil' + (isBest ? ' scan-best' : '') + '" data-code="' + c + '" style="cursor:pointer;background:' + btnBg + ';color:' + btnColor + ';padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap;margin:0 2px;">' + btnLabel + '</span></div>';
      }).join('');
      $('#scan-status').innerHTML = info + btns + '<div style="margin-top:6px;border-top:1px solid rgba(99,102,241,0.08);padding-top:4px;"><span class="scan-raw-toggle" style="cursor:pointer;font-size:10px;color:#64748b;user-select:none;">&#9660; Raw</span><pre class="scan-raw-text" style="display:none;margin:4px 0 0;font-size:10px;color:#94a3b8;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;font-family:Consolas,monospace;line-height:1.4;background:rgba(0,0,0,0.2);border-radius:4px;padding:6px 8px;">' + escapeHtml(allRaw) + '</pre></div>';
      $('#scan-status').className = 'scan-ok';
      var si = $('#scan-info'); if (si) si.style.display = 'inline';
    if (displayCodes.length === 1) {
      var c = displayCodes[0], kodeIn = $('#lite-kode'), kode2In = $('#lite-kode-2'), btn2x = $('#btn-2x');
      if (kodeIn.value && kode2In && c !== kodeIn.value) {
        if (btn2x && !btn2x.classList.contains('active')) btn2x.click();
        kode2In.value = c; kode2In.dispatchEvent(new Event('input', { bubbles: true }));
        scanSelections = [kodeIn.value, c];
      } else { kodeIn.value = c; kodeIn.dispatchEvent(new Event('input', { bubbles: true })); scanSelections = [c]; }
    }
    chrome.storage.local.get('_scanCounter', function(sc) {
      var seq = ((sc._scanCounter || 0) + 1);
      chrome.storage.local.set({ _scanCounter: seq });
      setData({ scanResult: { codes: allCodes, url: url, selected: scanSelections.slice(), source: 'popup', rawText: allRaw, codeInfo: allCodeMap, bestCodes: bestCodes, timestamp: new Date().toLocaleString('id-ID'), seq: seq } });
    });

    // Return canvases in prepCache to shared pool to minimize allocations
    try {
      if (prepCache) {
        Object.keys(prepCache).forEach(function(k) {
          var cv = prepCache[k];
          if (cv && cv.width) {
            cv.width = 0; cv.height = 0;
            if (!window._sharedCanvasPool) window._sharedCanvasPool = [];
            if (window._sharedCanvasPool.length < 6) window._sharedCanvasPool.push(cv);
          }
        });
        prepCache = {};
      }
    } catch (e) { console.log('pool return error', e); }
  } else {
    $('#scan-status').textContent = 'Tidak ditemukan kode tiket 19 digit'; $('#scan-status').className = 'scan-err';
  }
}

function setupPaste() {
  var pasteToggle = $('#paste-toggle');
  if (!pasteToggle) return;
  var lastClip = '';
  getData('autoPastePopup').then(function(r) { pasteToggle.checked = r.autoPastePopup === true; });
  pasteToggle.addEventListener('change', function() { setData({ autoPastePopup: this.checked }); });

  function readClip() {
    if (!pasteToggle.checked) return;
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function(t) { processClip(t); }).catch(function() {});
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
    var userIn = $('#lite-user');
    var kodeIn = $('#lite-kode');
    var kode2In = $('#lite-kode-2');
    var scanUrl = $('#scan-url');
    if (!userIn || !kodeIn) return;
    var btn2x = $('#btn-2x');
    var changed = [];
    if (t.indexOf('https://') === 0 || t.indexOf('http://') === 0) {
      if (scanUrl) { scanUrl.value = t; scanUrl.dispatchEvent(new Event('input', { bubbles: true })); }
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
}

document.addEventListener('DOMContentLoaded', function() {
  var scanUrl = $('#scan-url');
  var scanStatus = $('#scan-status');
  var kodeIn = $('#lite-kode');
  var kode2In = $('#lite-kode-2');
  var btn2x = $('#btn-2x');
  var scanTimer = null;

  // --- Dual Mode Toggle ---
  btn2x.addEventListener('click', function() {
    this.classList.toggle('active');
    isDualMode = this.classList.contains('active');
    $('#kode-2-wrap').style.display = isDualMode ? 'block' : 'none';
    if (!isDualMode && kode2In) { kode2In.value = ''; }
    saveFormState();
  });

  // --- Scan URL ---
  scanUrl.addEventListener('input', function() {
    var val = this.value.trim();
    if (!val) {
      scanStatus.textContent = '';
      scanStatus.className = '';
      scanSelections = [];
      chrome.storage.local.remove('scanResult');
      var si = $('#scan-info'); if (si) si.style.display = 'none';
      return;
    }
    if (!val.startsWith('http')) { scanStatus.textContent = 'Tempel URL gambar'; scanStatus.className = ''; return; }
    if (scanTimer) clearTimeout(scanTimer);
    _pasteStart = Date.now();
    scanTimer = setTimeout(function() { detectFromImage(val); }, 600);
  });

  // --- Scan Pick Click ---
  document.addEventListener('click', function(e) {
    if (e.target.id === 'scan-info') {
      var ex = $('#scan-source-popup');
      if (ex) { ex.remove(); return; }
      var m = window._scanSources || {};
      var html = Object.keys(m).map(function(c) { return '<div style="font-size:9px;padding:2px 0;border-bottom:1px solid #334155;">' + c.slice(0,16) + '<b>' + c.slice(-3) + '</b> <span style="color:#94a3b8;">→</span> ' + (m[c].sources||[]).join(', ') + '</div>'; }).join('');
      var pop = document.createElement('div');
      pop.id = 'scan-source-popup';
      pop.style.cssText = 'position:absolute;top:18px;right:0;background:#1e293b;border:1px solid #334155;border-radius:4px;padding:6px 8px;z-index:100;max-height:150px;overflow:auto;min-width:180px;';
      pop.innerHTML = html;
      $('#scan-status').appendChild(pop);
      return;
    }
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
          if (sr) setData({ scanResult: { codes: sr.codes, url: sr.url, selected: scanSelections.slice(), source: 'popup', rawText: sr.rawText, codeInfo: sr.codeInfo, bestCodes: sr.bestCodes, timestamp: sr.timestamp, seq: sr.seq } });
        });
        // Update ambil button + scan-pick visual
        function updateAmbilButtons() {
          var bestCodes = window._popupBestCodes || [];
          document.querySelectorAll('.scan-pick-ambil').forEach(function(b) {
            var c = b.dataset.code;
            var isPick = scanSelections.indexOf(c) >= 0;
            var isB = bestCodes.indexOf(c) >= 0;
            b.textContent = isPick ? '\u2715' : (isB ? '+Ambil' : 'Ambil');
            b.style.background = isPick ? '#ef4444' : (isB ? '#facc15' : '#22c55e');
            b.style.color = isPick ? '#fff' : (isB ? '#000' : '#fff');
          });
          document.querySelectorAll('.scan-pick').forEach(function(b) {
            var isSel = scanSelections.indexOf(b.dataset.code) >= 0;
            b.style.background = isSel ? '#818cf8' : '';
            b.style.color = isSel ? '#fff' : '';
            b.style.borderColor = isSel ? '#818cf8' : '';
          });
        }
        updateAmbilButtons();
      } else {
        var btn = ambil.parentElement.querySelector('.scan-pick');
        if (btn) { btn.click(); }
        // Update ambil button visual setelah scan-pick menambah selection
        updateAmbilButtons();
      }
      return;
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
      if (sr) setData({ scanResult: { codes: sr.codes, url: sr.url, selected: scanSelections.slice(), source: 'popup', rawText: sr.rawText, codeInfo: sr.codeInfo, bestCodes: sr.bestCodes, timestamp: sr.timestamp, seq: sr.seq } });
    });
    saveFormState();
  });

  // --- Enter to save ---
  kodeIn.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var user = $('#lite-user').value.trim();
      var kode = kodeIn.value.trim();
      var k2 = kode2In ? kode2In.value.trim() : '';
      liteAddRow(user, kode, k2);
    }
  });

  // --- Auto-proses saat user + kode terisi ---
  var _submitting = false;
  function tryAutoAdd() {
    if (_submitting) return;
    var u = $('#lite-user').value.trim();
    var k = kodeIn.value.trim();
    if (u && k && validPanjangKode(k)) {
      _submitting = true;
      liteAddRow(u, k, kode2In ? kode2In.value.trim() : '').then(function() { _submitting = false; }).catch(function() { _submitting = false; });
    }
  }
  $('#lite-user').addEventListener('input', function() { tryAutoAdd(); });
  kodeIn.addEventListener('input', function() { tryAutoAdd(); });
  if (kode2In) kode2In.addEventListener('input', function() { tryAutoAdd(); });

  // --- CRUD: Edit ---
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.btn-edit');
    if (!btn) return;
    var id = parseInt(btn.dataset.id);
    getData('rows').then(function(r) {
      var rows = r.rows || [];
      var row = rows.find(function(x) { return x.id === id; });
      if (!row) { showToast('Data tidak ditemukan', true); return; }
      $('#lite-user').value = row.user || '';
      $('#lite-kode').value = row.kodeTiket || row.kode || '';
      if (row.kode2) {
        if (!btn2x.classList.contains('active')) btn2x.click();
        kode2In.value = row.kode2 || '';
      }
      rows = rows.filter(function(x) { return x.id !== id; });
      setData({ rows: rows }).then(function() {
        renderLiteData();
        showToast('Data siap diedit, simpan dengan Enter');
        saveFormState();
      });
    });
  });

  // --- CRUD: Delete ---
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.btn-delete');
    if (!btn) return;
    var id = parseInt(btn.dataset.id);
    if (!confirm('Hapus data ini?')) return;
    getData('rows').then(function(r) {
      var rows = (r.rows || []).filter(function(x) { return x.id !== id; });
      setData({ rows: rows }).then(function() {
        renderLiteData();
        showToast('Data dihapus');
      });
    });
  });

  // --- CRUD: Retry Cekbet ---
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.btn-retry-cekbet');
    if (!btn) return;
    var id = parseInt(btn.dataset.id);
    getData('rows').then(function(r) {
      var rows = r.rows || [];
      var row = rows.find(function(x) { return x.id === id; });
      if (!row) { showToast('Data tidak ditemukan', true); return; }
      resetCekBet(row);
      row.updatedAt = Date.now();
      setData({ rows: rows }).then(function() {
        renderLiteData();
        showToast('Cek ulang dijadwalkan');
        chrome.runtime.sendMessage({ type: 'RETRY_CEKBET', rowId: id });
      });
    });
  });

  // --- CRUD: Retry Bonus ---
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.btn-retry-bonus');
    if (!btn) return;
    var id = parseInt(btn.dataset.id);
    getData('rows').then(function(r) {
      var rows = r.rows || [];
      var row = rows.find(function(x) { return x.id === id; });
      if (!row) { showToast('Data tidak ditemukan', true); return; }
      resetBonus(row);
      row.updatedAt = Date.now();
      setData({ rows: rows }).then(function() {
        renderLiteData();
        showToast('Input bonus dijadwalkan');
        chrome.runtime.sendMessage({ type: 'RETRY_BONUS', rowId: id });
      });
    });
  });

  // --- Bulk: Select All ---
  $('#select-all').addEventListener('change', function() {
    document.querySelectorAll('.bulk-cb').forEach(function(cb) { cb.checked = this.checked; }, this);
    updateBulkInfo();
  });

  document.addEventListener('change', function(e) {
    if (e.target.classList.contains('bulk-cb')) updateBulkInfo();
  });

  // --- Bulk: Cek Ulang ---
  $('#btn-cekbet-selected').addEventListener('click', function() {
    var ids = getSelectedIds();
    if (!ids.length) { showToast('Pilih data terlebih dahulu', true); return; }
    getData('rows').then(function(r) {
      var rows = r.rows || [];
      ids.forEach(function(id) {
        var row = rows.find(function(x) { return x.id === id; });
        if (row) { resetCekBet(row); row.updatedAt = Date.now(); }
      });
      setData({ rows: rows }).then(function() {
        renderLiteData();
        showToast(ids.length + ' data dijadwalkan cek ulang');
        ids.forEach(function(id) { chrome.runtime.sendMessage({ type: 'RETRY_CEKBET', rowId: id }); });
        uncheckAll();
      });
    });
  });

  // --- Bulk: Input Bonus ---
  $('#btn-bonus-selected').addEventListener('click', function() {
    var ids = getSelectedIds();
    if (!ids.length) { showToast('Pilih data terlebih dahulu', true); return; }
    getData('rows').then(function(r) {
      var rows = r.rows || [];
      ids.forEach(function(id) {
        var row = rows.find(function(x) { return x.id === id; });
        if (row) { resetBonus(row); row.updatedAt = Date.now(); }
      });
      setData({ rows: rows }).then(function() {
        renderLiteData();
        showToast(ids.length + ' data dijadwalkan input bonus');
        ids.forEach(function(id) { chrome.runtime.sendMessage({ type: 'RETRY_BONUS', rowId: id }); });
        uncheckAll();
      });
    });
  });

  // --- Bulk: Delete ---
  $('#btn-delete-selected').addEventListener('click', function() {
    var ids = getSelectedIds();
    if (!ids.length) { showToast('Pilih data terlebih dahulu', true); return; }
    if (!confirm('Hapus ' + ids.length + ' data terpilih?')) return;
    getData('rows').then(function(r) {
      var rows = (r.rows || []).filter(function(x) { return ids.indexOf(x.id) < 0; });
      setData({ rows: rows }).then(function() {
        renderLiteData();
        showToast(ids.length + ' data dihapus');
        uncheckAll();
      });
    });
  });

  // --- Open Dashboard ---
  $('#open-dashboard').addEventListener('click', function(e) {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
  });

  // --- Password Generator ---
  var genUser = $('#gen-user');
  var genResult = $('#gen-result');
  var _pwCopiedTimeout = null;
  var _pwRestoring = false;

  function showGenResult(val, password) {
    genResult.innerHTML =
      '<div class="pw-line"><span class="pw-label">User ID :</span><span class="pw-value">' + escapeHtml(val) + '</span></div>' +
      '<div class="pw-line"><span class="pw-label">Password :</span><span class="pw-value" id="pw-display">' + escapeHtml(password) + '</span>' +
      '<button class="pw-copy-btn" id="pw-copy-btn">Salin Sandi</button></div>' +
      '<div class="pw-message">Silahkan dicoba login dan segera diganti passwordnya ya bosku</div>' +
      '<button class="pw-copy-btn" id="pw-copy-all" style="margin-top:8px;background:linear-gradient(135deg,#a78bfa,#7c3aed);">Salin Data</button>';
    genResult.style.display = 'block';

    function copyText(text, btn) {
      if (_pwCopiedTimeout) clearTimeout(_pwCopiedTimeout);
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
      _pwCopiedTimeout = setTimeout(function() {
        btn.textContent = btn === copyBtn ? 'Salin Sandi' : 'Salin Data';
        btn.classList.remove('copied');
      }, 2000);
    }
    var copyBtn = $('#pw-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', function() { copyText(password, copyBtn); });
    var copyAll = $('#pw-copy-all');
    if (copyAll) {
      var fullText = 'User ID : ' + val + '\nPassword : ' + password + '\n\nSilahkan dicoba login dan segera diganti passwordnya ya bosku';
      copyAll.addEventListener('click', function() { copyText(fullText, copyAll); });
    }
  }

  genUser.addEventListener('input', function() {
    if (_pwRestoring) return;
    var val = genUser.value.trim();

    var userIn = $('#lite-user');
    if (userIn && userIn.value.trim()) {
      userIn.value = '';
      userIn.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (!val || val.indexOf(' ') >= 0 || val.length < 4) {
      genResult.innerHTML = '';
      genResult.style.display = 'none';
      chrome.storage.local.remove('genData');
      return;
    }
    var password = generatePassword();
    showGenResult(val, password);
    chrome.storage.local.set({ genData: { user: val, password: password } });
  });



  // --- Init ---
  renderLiteData();

  // Tunggu restore selesai sebelum aktifkan paste (cegah race condition)
  Promise.all([
    getData('genData').then(function(r) {
      var d = r.genData;
      if (d && d.user && d.password) {
        _pwRestoring = true;
        genUser.value = d.user;
        showGenResult(d.user, d.password);
        _pwRestoring = false;
      }
    }),
    // scanResult: restore tombol pilihan scan
    getData('scanResult').then(function(r) {
      var sr = r.scanResult;
      if (sr && Array.isArray(sr.codes) && sr.codes.length > 0) {
        scanSelections = Array.isArray(sr.selected) ? sr.selected : (sr.selected ? [sr.selected] : []);          var btns = sr.codes.map(function(c, idx) {
           return '<div style="margin:2px 0;display:flex;align-items:center;"><button class="btn btn-sm scan-pick" data-code="' + c + '" style="font-family:monospace;font-size:11px;flex:1;text-align:left;padding:4px 8px;">' + c + '</button><span class="scan-pick-ambil" data-code="' + c + '" style="cursor:pointer;background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap;margin:0 2px;">✕</span></div>';
        }).join('');
        if (scanSelections[0] && !kodeIn.value) { kodeIn.value = scanSelections[0]; }
        if (scanSelections[1] && kode2In && !kode2In.value) {
          if (!btn2x.classList.contains('active')) btn2x.click();
          kode2In.value = scanSelections[1];
        }
        scanStatus.innerHTML = btns;
        scanStatus.className = 'scan-ok';
      }
    }),
  ]).then(function() {
    setupPaste();
    tryAutoAdd();
  });
});
