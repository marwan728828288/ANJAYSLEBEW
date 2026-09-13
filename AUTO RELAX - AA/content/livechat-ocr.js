(function() {
  var reqCounter = 0;
  var pageReady = false;
  var pendingResults = {};
  var pendingTimers = {};

  /* Dedup: cegah scan ganda untuk URL yang sama */
  var _inflightOcr = {};

  /* ---- Cache hasil OCR (memori) — hasil tidak hilang saat pindah chat ----
     TTL: kode tiket 10 menit, NAMA/RRN (isAllText) 30 menit. */
  var _ocrMemCache = {};
  var OCR_CACHE_TTL = 10 * 60 * 1000; /* kode tiket: 10 menit */
  var OCR_CACHE_TTL_ALL = 30 * 60 * 1000; /* NAMA/RRN: 30 menit */
  function ocrCacheGet(url) {
    var e = _ocrMemCache[url];
    if (!e) return null;
    var ttl = e.ttl || OCR_CACHE_TTL;
    if (Date.now() - e.t > ttl) { delete _ocrMemCache[url]; return null; }
    return e.d;
  }
  function ocrCacheSet(url, result) {
    try {
      if (!result || result.error) return;
      if (!(result.codes && result.codes.length) && !result.text) return;
      _ocrMemCache[url] = { t: Date.now(), d: result, ttl: result.isAllText ? OCR_CACHE_TTL_ALL : OCR_CACHE_TTL };
    } catch(e) {}
  }

  function isInModal(el) {
    if (!el) return false;
    var p = el;
    /* Naik hingga 12 level — preview LiveChat (modal) biasanya bersarang dalam
       6-7+ level (wrapper → content → viewer → modal-root → portal → body). */
    for (var i = 0; i < 12 && p; i++) {
      if (p.getAttribute && p.getAttribute('role') === 'dialog') return true;
      var c = typeof p.className === 'string' ? p.className.toLowerCase() : '';
      if (c.indexOf('modal') >= 0 || c.indexOf('overlay') >= 0 || c.indexOf('preview') >= 0 || c.indexOf('lightbox') >= 0 || c.indexOf('image-viewer') >= 0 || c.indexOf('viewer') >= 0 || c.indexOf('gallery') >= 0) return true;
      p = p.parentElement;
    }
    return false;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function(c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  /* iframe-based Tesseract.js OCR */
  var iframeSource = null;
  var iframeElement = null;
  var iframeLastPong = 0;
  var iframeHeartbeat = null;

  function recreateIframe() {
    try {
      if (iframeElement && iframeElement.parentNode) iframeElement.parentNode.removeChild(iframeElement);
    } catch(e) {}
    iframeElement = document.createElement('iframe');
    iframeElement.src = chrome.runtime.getURL('pages/ocr-frame.html');
    iframeElement.style.cssText = 'visibility:hidden;position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;border:none;';
    document.documentElement.appendChild(iframeElement);
    iframeElement.onload = function() {
      iframeSource = iframeElement.contentWindow;
      iframeLastPong = Date.now();
    };
  }

  function startIframeMonitor() {
    if (iframeHeartbeat) return;
    iframeHeartbeat = setInterval(function() {
      try {
        if (!iframeSource) {
          // try recreate
          recreateIframe();
          return;
        }
        // send ping
        iframeSource.postMessage({ type: 'PING' }, '*');
        // if no pong for 30s, recreate
        if (Date.now() - iframeLastPong > 30000) {
          console.log('livechat-ocr: iframe unresponsive, recreating');
          recreateIframe();
        }
      } catch(e) { recreateIframe(); }
    }, 10000);
  }

  function ensureIframe() {
    return new Promise(function(resolve) {
      if (iframeSource) { resolve(iframeSource); startIframeMonitor(); return; }
      recreateIframe();
      var t = setInterval(function() {
        if (iframeSource) { clearInterval(t); startIframeMonitor(); resolve(iframeSource); }
      }, 250);
    });
  }

  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.type === 'OCR_SCRIPTS_INJECTED') pageReady = true;
  });

  window.addEventListener('message', function(e) {
    if (!e.data) return;

    if (e.data.type === 'OCR_IFRAME_READY') {
      pageReady = true;
      iframeLastPong = Date.now();
      return;
    }

    if (e.data.type === 'PONG') {
      iframeLastPong = Date.now();
      return;
    }

    if (e.data.type === 'OCR_RESULT') {
      if (pendingTimers[e.data.reqId]) { clearTimeout(pendingTimers[e.data.reqId]); delete pendingTimers[e.data.reqId]; }
      var handlers = pendingResults[e.data.reqId];
      if (handlers) {
        handlers.forEach(function(fn) { fn(e.data); });
        delete pendingResults[e.data.reqId];
      }
    }

    if (e.data.type === 'OCR_RESULT_ALL') {
      if (pendingTimers[e.data.reqId]) { clearTimeout(pendingTimers[e.data.reqId]); delete pendingTimers[e.data.reqId]; }
      var handlers = pendingResults[e.data.reqId];
      if (handlers) {
        e.data.isAllText = true;
        handlers.forEach(function(fn) { fn(e.data); });
        delete pendingResults[e.data.reqId];
      }
    }
  });

  function getReqId() { return 'ocr_' + (++reqCounter) + '_' + Date.now(); }

  function runOcr(url, fetchUrl) {
    return new Promise(function(resolve) {
      var reqId = getReqId();
      if (!pendingResults[reqId]) pendingResults[reqId] = [];
      pendingResults[reqId].push(resolve);

      var timer = setTimeout(function() {
        delete pendingTimers[reqId];
        var handlers = pendingResults[reqId];
        if (handlers) {
          handlers.forEach(function(fn) { fn({ codes: [], error: 'OCR timeout', lines: [] }); });
          delete pendingResults[reqId];
        }
      }, 120000); /* 120s — model best + canvas besar (7.2MP) butuh waktu; 25s dulu memutus scan potret HP */
      pendingTimers[reqId] = timer;

      async function send() {
        if (!pendingResults[reqId]) { clearTimeout(timer); delete pendingTimers[reqId]; return; }
        var ocrUrl = fetchUrl || url;
        if (pageReady && iframeSource) {
          iframeSource.postMessage({ type: 'OCR_RUN', url: ocrUrl, reqId: reqId }, '*');
        } else {
          try {
            var src = await ensureIframe();
            src.postMessage({ type: 'OCR_RUN', url: ocrUrl, reqId: reqId }, '*');
          } catch(err) {
            clearTimeout(timer); delete pendingTimers[reqId];
            var handlers = pendingResults[reqId];
            if (handlers) {
              handlers.forEach(function(fn) { fn({ codes: [], error: 'OCR init failed: ' + (err.message || err), lines: [] }); });
              delete pendingResults[reqId];
            }
          }
        }
      }
      send();
    });
  }

  /* OCR memakai cache memori (ocrCacheGet/ocrCacheSet) — hasil tidak hilang saat
     pindah chat; TTL kode tiket 10 mnt, NAMA/RRN (isAllText) 30 mnt; tombol ↻
     memaksa scan ulang. Dedup _inflightOcr mencegah scan ganda untuk URL sama. */

  function freezeHeight(anchor, fn) {
    var h = anchor.offsetHeight;
    anchor.style.minHeight = h + 'px';
    fn();
    requestAnimationFrame(function() {
      anchor.style.minHeight = '';
    });
  }

  function getTokens(str) {
    if (!str) return [];
    var cleaned = str.replace(/[+]/g, ' ');
    var m = cleaned.match(/\d+/g);
    return m || [];
  }

  function tryBestSplit(foundCodes, lines, lineIdx) {
    for (var j = Math.min(lineIdx - 1, lines.length - 1); j >= Math.max(0, lineIdx - 2); j--) {
      var toks = getTokens(lines[j]);
      for (var a = toks.length - 1; a >= 0; a--) {
        if (toks[a].length >= 19 && toks[a][0] === '2' && foundCodes.indexOf(toks[a].substring(0, 19)) >= 0) return toks[a].substring(0, 19);
        if (toks[a].length === 9 && toks[a][0] === '2') {
          var nextToks = getTokens(lines[j + 1]);
          for (var b = 0; b < nextToks.length; b++) {
            if (nextToks[b].length === 10) {
              var cand = toks[a] + nextToks[b];
              if (foundCodes.indexOf(cand) >= 0) return cand;
            }
          }
          if (j + 2 < lines.length) {
            var mid = getTokens(lines[j + 1]);
            var skip = true;
            for (var m = 0; m < mid.length; m++) { if (mid[m].length >= 9) { skip = false; break; } }
            if (skip) {
              var nextToks = getTokens(lines[j + 2]);
              for (var b = 0; b < nextToks.length; b++) {
                if (nextToks[b].length === 10) {
                  var cand = toks[a] + nextToks[b];
                  if (foundCodes.indexOf(cand) >= 0) return cand;
                }
              }
            }
          }
        }
        if (toks[a].length === 10) {
          if (j > 0) {
            var prevToks = getTokens(lines[j - 1]);
            for (var b = 0; b < prevToks.length; b++) {
              if (prevToks[b].length === 9 && prevToks[b][0] === '2') {
                var cand = prevToks[b] + toks[a];
                if (foundCodes.indexOf(cand) >= 0) return cand;
              }
            }
            if (j > 1) {
              var mid = getTokens(lines[j - 1]);
              var skip = true;
              for (var m = 0; m < mid.length; m++) { if (mid[m].length >= 9) { skip = false; break; } }
              if (skip) {
                var prevToks = getTokens(lines[j - 2]);
                for (var b = 0; b < prevToks.length; b++) {
                  if (prevToks[b].length === 9 && prevToks[b][0] === '2') {
                    var cand = prevToks[b] + toks[a];
                    if (foundCodes.indexOf(cand) >= 0) return cand;
                  }
                }
              }
            }
          }
        }
      }
    }
    return '';
  }

  /* Baris pemisah multi-pass (mis. "── dil ps6 ──") adalah TEMBOK: kode tidak
     boleh dicari menembusnya. Dukung U+2500 (─) maupun ASCII (-/=). */
  function isSeparatorLine(line) {
    if (!line) return false;
    // Label boleh mengandung spasi (mis. "── dil ps6 ──"): [A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*
    return /[-─=]{2,}\s*[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*\s*[-─=]{2,}/.test(line);
  }
  /* Pecah baris gabungan multi-pass menjadi blok per-pass — setiap blok diproses
     terpisah sehingga + dari satu pass tidak bisa mengambil kode dari pass lain. */
  function splitPassBlocks(lines) {
    if (!lines || !lines.length) return [];
    var blocks = [], cur = [];
    for (var i = 0; i < lines.length; i++) {
      if (isSeparatorLine(lines[i])) {
        if (cur.length) blocks.push(cur);
        cur = [];
      } else {
        cur.push(lines[i]);
      }
    }
    if (cur.length) blocks.push(cur);
    return blocks;
  }

  function getAllBestCodes(lines, foundCodes, relaxed) {
    var results = [];
    function addCode(r) {
      if (r && results.indexOf(r) === -1) results.push(r);
    }

    /* Pecah baris gabungan multi-pass jadi blok per-pass — setiap blok diproses
       terpisah sehingga + dari satu pass tidak bisa mengambil kode dari pass lain
       (bug "29965+ ngambil kode 208328747"). */
    var blocks = splitPassBlocks(lines);
    for (var bi = 0; bi < blocks.length; bi++) {
      var block = blocks[bi];
      /* Normalisasi: hilangkan spasi di sekitar + agar baris "10000 + 500000" tetap terbaca */
      for (var ni = 0; ni < block.length; ni++) {
        block[ni] = block[ni].replace(/ ?\+ ?/g, '+');
      }
      for (var i = 0; i < block.length; i++) {
        if (block[i].indexOf('+') >= 0 && !block[i].match(/^\d{2}:\d{2}/)) {
          var idx = block[i].indexOf('+');
          if ((idx > 0 && block[i][idx - 1] === ' ') || (idx < block[i].length - 1 && block[i][idx + 1] === ' ')) continue;
          var before = block[i].substring(0, idx).match(/\d+/g);
          var after = block[i].substring(idx + 1).match(/\d+/g);
          var strict = before && before.length && after && after.length;
          var loose = (before && before.length) || (after && after.length);
          if (strict || (relaxed && loose)) {
            addCode(tryBestSplit(foundCodes, block, i));
          }
        }
      }
    }
    return results;
  }
 
  /* Ukuran gambar ASLI (sebelum crop/zoom) dari elemen <img> — ditampilkan di
     header hasil OCR di samping durasi, mis. "OCR · 3.2s · 720×1600". */
  function _lcSrcSizeStr(anchor) {
    try {
      var si = anchor ? anchor.querySelector('img[data-lc-ocr="1"]') : null;
      if (si && si.naturalWidth && si.naturalHeight) return ' &middot; ' + si.naturalWidth + '\u00D7' + si.naturalHeight;
    } catch(e) {}
    return '';
  }

  /* Ukuran SCALE yang dipakai OCR (procInfo.scale — zoom efektif canvas yang
     dikirim ke Tesseract) — ditampilkan di header hasil OCR setelah ukuran
     sumber, mis. "OCR · 1.4s · 720×1600 · ×1.50". Bila smart auto-scale naik
     dan pemenang ada di scale lain (climbInfo.bestScale), tampilkan juga: "×1.50 → ×2.50". */
  function _lcScaleStr(result) {
    try {
      if (!result) return '';
      var s = 0, bs = 0;
      if (result.procInfo && result.procInfo.scale) s = parseFloat(result.procInfo.scale);
      if (result.climbInfo && result.climbInfo.bestScale) bs = parseFloat(result.climbInfo.bestScale);
      if (s > 0) {
        var str = ' &middot; \u00D7' + (Math.round(s * 100) / 100).toFixed(2);
        if (bs > 0 && Math.abs(bs - s) > 0.01) str += ' \u2192 \u00D7' + (Math.round(bs * 100) / 100).toFixed(2);
        return str;
      }
    } catch(e) {}
    return '';
  }

  /* Setel state hasil OCR: open=true (semua kode tampil) / open=false (collapse). */
  function _lcSetMore(resEl, open) {
    if (!resEl) return;
    var moreWrap = resEl.querySelector('.lc-ocr-more');
    var moreToggle = resEl.querySelector('.lc-ocr-more-toggle');
    if (!moreWrap) return;
    moreWrap.style.display = open ? 'block' : 'none';
    if (moreToggle) moreToggle.textContent = open ? '▲ Sembunyikan' : ('▼ ' + (moreToggle.getAttribute('data-count') || '0') + ' kode lain');
  }

  /* Setelah kode di-pick (Ambil): sisanya di-hide lagi; baris yang sudah di-pick (✕)
     dipindah ke area terlihat agar tidak ikut tersembunyi (instruksi user). */
  function _lcCollapseAfterPick(resEl) {
    if (!resEl) return;
    var moreWrap = resEl.querySelector('.lc-ocr-more');
    var moreToggle = resEl.querySelector('.lc-ocr-more-toggle');
    if (!moreWrap) return;
    var rows = moreWrap.children;
    var moved = 0;
    for (var ri = rows.length - 1; ri >= 0; ri--) {
      var pb = rows[ri].querySelector('.lc-ocr-pick');
      if (pb && pb.textContent === '\u2715') {
        if (moreToggle && moreToggle.parentNode) moreToggle.parentNode.insertBefore(rows[ri], moreToggle);
        moved++;
      }
    }
    moreWrap.style.display = 'none';
    if (moreToggle) {
      var n = Math.max(0, parseInt(moreToggle.getAttribute('data-count') || '0', 10) - moved);
      if (n <= 0) { moreToggle.parentNode.removeChild(moreToggle); }
      else {
        moreToggle.setAttribute('data-count', String(n));
        moreToggle.textContent = '▼ ' + n + ' kode lain';
      }
    }
  }

  /* Shared result display */
  function showOcrResult(anchor, result, url) {
    var existing = anchor.querySelector('.lc-ocr-result');

    // Pakai bestCodes dari dashboard (identik dengan dashboard); hitung ulang hanya jika kosong
    var bestCodes = Array.isArray(result.bestCodes) && result.bestCodes.length ? result.bestCodes.slice() : [];
    var resEl;
    freezeHeight(anchor, function() {
      if (existing) existing.remove();
      if (result.error || !result.codes.length) {
        var errEl = document.createElement('div');
        errEl.className = 'lc-ocr-result';
        errEl.textContent = result.error || 'Tidak ditemukan kode';
        errEl.style.cssText = 'background:rgba(185,28,28,0.9) !important;color:#fff !important;padding:6px 8px !important;font-size:11px !important;font-family:Arial,sans-serif !important;line-height:1.4 !important;text-align:center !important;pointer-events:auto !important;' + (isInModal(anchor) ? 'position:absolute !important;bottom:36px !important;left:0 !important;right:0 !important;z-index:999999 !important;' : '');
        var apErr = window.getComputedStyle(anchor).position;
        if (apErr === 'static') anchor.style.position = 'relative';
        anchor.appendChild(errEl);
        return;
      }

    if (bestCodes.length === 0) {
    var rawLines = result.varRawLines || result.varLines;
    for (var pass = 0; pass < 2; pass++) {
      if (rawLines) {
        // Multi-pass (PSM 6 + PSM 3) — semua baris hasil varian masuk untuk +Ambil
        for (var vi = 0; vi < rawLines.length; vi++) {
          var found = getAllBestCodes(rawLines[vi], result.codes, pass === 1);
          found.forEach(function(c) {
            if (c && result.codeInfo && result.codeInfo[c] && result.codeInfo[c].count >= 1 && bestCodes.indexOf(c) === -1) {
              bestCodes.push(c);
            }
          });
        }
      } else {
        var found = getAllBestCodes(result.var0Lines || result.lines || [], result.codes, pass === 1);
        found.forEach(function(c) {
          if (c && result.codeInfo && result.codeInfo[c] && result.codeInfo[c].count >= 1 && bestCodes.indexOf(c) === -1) {
            bestCodes.push(c);
          }
        });
      }
    }
    }
    var elapsedStr = result.elapsed ? ' &middot; ' + result.elapsed + 's' : '';
    var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;font-size:9px;">OCR' + elapsedStr + _lcSrcSizeStr(anchor) + _lcScaleStr(result) + '</span><span class="lc-ocr-refresh" style="cursor:pointer;color:#818cf8;font-size:12px;padding:2px 6px;border-radius:3px;flex-shrink:0;">↻</span></div>';
    var topCode = bestCodes.length > 0 ? bestCodes[0] : (result.codes.length === 1 ? result.codes[0] : null);
    /* Aturan hide (instruksi user): default COLLAPSE — baris +Ambil tampil, sisanya
       di-hide di balik toggle. Gambar diklik (modal preview) → otomatis unhide
       (semua tampil). Kode di-pick → sisanya hide lagi. Kode tunggal → +Ambil.
       TANPA +Ambil (bestCodes kosong) → SEMUA kode tampil tanpa hide — tidak ada
       baris prioritas, jadi tidak ada yang perlu disembunyikan (instruksi user). */
    /* Modal preview: isInModal (heuristic class) ATAU gambar bersumber findImageModal
       (data-lc-modalimg — sinyal andal, di-set di scanForImages saat modal terdeteksi). */
    var inModal = isInModal(anchor) || (anchor.querySelector('img[data-lc-ocr="1"][data-lc-modalimg="1"]') !== null);
    var shownHtml = '', moreHtml = '', moreCount = 0;
    var noBest = bestCodes.length === 0;
    for (var i = 0; i < result.codes.length; i++) {
      var c = result.codes[i];
      var isBest = bestCodes.indexOf(c) >= 0 || result.codes.length === 1;
      var rowHtml = '<div style="margin:2px 0;display:flex;align-items:center;gap:4px;">';
      rowHtml += '<span style="flex:1;text-align:left;font-family:monospace;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (i+1) + '. ' + c.slice(0,16) + '<span style="font-size:18px;font-weight:bold">' + c.slice(-3) + '</span></span>';
      rowHtml += '<span class="lc-ocr-pick' + (isBest ? ' lc-ocr-best' : '') + '" data-code="' + c + '" style="cursor:pointer;background:' + (isBest ? '#facc15' : '#22c55e') + ';color:' + (isBest ? '#000' : '#fff') + ';padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap;">' + (isBest ? '+Ambil' : 'Ambil') + '</span>';
      rowHtml += '</div>';
      if (isBest || noBest) { shownHtml += rowHtml; }
      else { moreHtml += rowHtml; moreCount++; }
    }
    html += shownHtml;
    if (moreCount > 0) {
      html += '<div class="lc-ocr-more-toggle" data-count="' + moreCount + '" style="cursor:pointer;color:#94a3b8;font-size:9px;font-weight:600;letter-spacing:.4px;padding:2px 0 0;user-select:none;">' + (inModal ? '▲ Sembunyikan' : '▼ ' + moreCount + ' kode lain') + '</div>';
      html += '<div class="lc-ocr-more"' + (inModal ? '' : ' style="display:none;"') + '>' + moreHtml + '</div>';
    }

    if (inModal) {
      var apM = window.getComputedStyle(anchor).position;
      if (apM === 'static') anchor.style.position = 'relative';
    }
    resEl = document.createElement('div');
    resEl.className = 'lc-ocr-result';
    var rs = 'background:rgba(8,11,20,0.95) !important;color:#fff !important;padding:6px 8px !important;font-size:11px !important;font-family:Arial,sans-serif !important;line-height:1.4 !important;text-align:left !important;pointer-events:auto !important;';
    if (inModal) rs += 'position:absolute !important;bottom:36px !important;left:0 !important;right:0 !important;z-index:999999 !important;max-height:70% !important;overflow-y:auto !important;';
    resEl.style.cssText = rs;
    resEl.innerHTML = html;

    resEl.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      var refresh = e.target.closest('.lc-ocr-refresh');
      if (refresh) {
        e.stopPropagation();
        var imgEl = anchor.querySelector('img[data-lc-ocr="1"]');
        if (imgEl) handleOcrClick(imgEl, anchor, false, true); /* ↻ = paksa scan ulang */
        return;
      }
      var moreToggle = e.target.closest('.lc-ocr-more-toggle');
      if (moreToggle) {
        e.stopPropagation();
        var moreWrap = resEl.querySelector('.lc-ocr-more');
        _lcSetMore(resEl, moreWrap && moreWrap.style.display === 'none');
        return;
      }
      var pick = e.target.closest('.lc-ocr-pick');
      if (!pick) return;
      e.stopPropagation();
      var code = pick.getAttribute('data-code');
      if (pick.textContent === '\u2715') {
        _lcRemove(code);
        _unmarkPicked(url, code);
        var isBest = pick.classList.contains('lc-ocr-best');
        pick.textContent = isBest ? '+Ambil' : 'Ambil';
        pick.style.background = isBest ? '#facc15' : '#22c55e';
        pick.style.color = isBest ? '#000' : '#fff';
        return;
      }
      _lcPick(code, true);
      _markPicked(url, code);
      pick.textContent = '\u2715';
      pick.style.background = '#ef4444';
      /* Setelah Ambil di-pick → sisanya di-hide lagi (instruksi user) */
      _lcCollapseAfterPick(resEl);
    });

    resEl.setAttribute('data-ocr-url', url || '');
    resEl.setAttribute('data-lc-modal', inModal ? '1' : '0'); /* konteks render: feed(0) / modal(1) */
    anchor.appendChild(resEl);
    }); /* end freezeHeight */

    /* Auto Ambil: pick first best code automatically, or single code (skip if already picked) */
    var autoCode = bestCodes.length > 0 ? bestCodes[0] : (result.codes.length === 1 ? result.codes[0] : null);
    if (_lcAutoAmbil && autoCode) {
      _getPickedCodes(url, function(alreadyPicked) {
        if (alreadyPicked.indexOf(autoCode) >= 0) return;
        setTimeout(function() {
          _lcPick(autoCode, true);
          var pickBtn = resEl.querySelector('.lc-ocr-pick[data-code="' + autoCode + '"]');
          if (pickBtn) {
            pickBtn.textContent = '\u2715';
            pickBtn.style.background = '#ef4444';
            pickBtn.style.color = '#fff';
          }
          _markPicked(url, autoCode);
        }, 100);
      });
    }

    /* Restore picked state for already-picked codes */
    _getPickedCodes(url, function(picked) {
      if (!picked || !picked.length) return;
      for (var pi = 0; pi < picked.length; pi++) {
        var pickBtn = resEl.querySelector('.lc-ocr-pick[data-code="' + picked[pi] + '"]');
        if (pickBtn && pickBtn.textContent !== '\u2715') {
          pickBtn.textContent = '\u2715';
          pickBtn.style.background = '#ef4444';
          pickBtn.style.color = '#fff';
        }
      }
    });
  }

  /* ---- Tampilkan hasil OCR NAMA/RRN (raw text) ---- */
  function showOcrResultAll(anchor, result, url) {
    freezeHeight(anchor, function() {
      var existing = anchor.querySelector('.lc-ocr-result');
      if (existing) existing.remove();

      var inModal = isInModal(anchor) || (anchor.querySelector('img[data-lc-ocr="1"][data-lc-modalimg="1"]') !== null);
      if (inModal) {
        var apM = window.getComputedStyle(anchor).position;
        if (apM === 'static') anchor.style.position = 'relative';
      }
      var resEl = document.createElement('div');
      resEl.className = 'lc-ocr-result';
      var rs = 'background:rgba(8,11,20,0.95) !important;color:#fff !important;padding:6px 8px !important;font-size:11px !important;font-family:Arial,sans-serif !important;line-height:1.4 !important;text-align:left !important;pointer-events:auto !important;';
      if (inModal) rs += 'position:absolute !important;bottom:36px !important;left:0 !important;right:0 !important;z-index:999999 !important;max-height:70% !important;overflow-y:auto !important;';
      resEl.style.cssText = rs;

      var elapsedStr = result.elapsed ? ' &middot; ' + result.elapsed + 's' : '';
      var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#10b981;font-size:9px;font-weight:600;">NAMA/RRN' + elapsedStr + _lcSrcSizeStr(anchor) + '</span>' +
        '<span style="cursor:pointer;color:#94a3b8;font-size:11px;padding:2px 6px;border-radius:3px;flex-shrink:0;" class="lc-all-copy" title="Salin teks">\u2398</span>' +
        '</div>';

      var textLines = result.lines || [];
      if (result.error && !textLines.length) {
        html += '<div style="color:#ef4444;font-size:10px;">' + escapeHtml(result.error) + '</div>';
      } else {
        html += '<div class="lc-all-text" style="font-family:monospace;font-size:10px;color:#e2e8f0;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto;background:rgba(0,0,0,0.2);border-radius:4px;padding:4px 6px;margin-bottom:4px;">';
        for (var li = 0; li < textLines.length; li++) {
          html += escapeHtml(textLines[li]) + '\n';
        }
        html += '</div>';
      }

      resEl.innerHTML = html;
      resEl.setAttribute('data-lc-modal', inModal ? '1' : '0'); /* stabil untuk loop konteks feed↔modal */

      resEl.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        var copyBtn = e.target.closest('.lc-all-copy');
        if (copyBtn) {
          var textEl = resEl.querySelector('.lc-all-text');
          if (textEl) {
            var copyText = textEl.textContent || '';
            var ta = document.createElement('textarea');
            ta.value = copyText;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            copyBtn.textContent = '\u2713';
            copyBtn.style.color = '#10b981';
            setTimeout(function() {
              copyBtn.textContent = '\u2398';
              copyBtn.style.color = '#94a3b8';
            }, 1500);
          }
        }
      });

      anchor.appendChild(resEl);
    });
  }

  /* === UI: Detect images and show OCR button === */
  function findImageModal() {
    var selectors = [
      '[role="dialog"] img:not([data-lc-ocr])',
      '[class*="modal"] img:not([data-lc-ocr])',
      '[class*="overlay"] img:not([data-lc-ocr])',
      '[class*="preview"] img:not([data-lc-ocr])',
      '[data-testid="modal"] img:not([data-lc-ocr])',
      '[class*="image-viewer"] img:not([data-lc-ocr])',
      '[class*="lightbox"] img:not([data-lc-ocr])',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function findChatImages() {
    var imgs = [];
    var selectors = [
      '[class*="message"] img[src*="http"]',
      '[data-testid*="message"] img[src*="http"]',
      '[class*="chat-feed"] img[src*="http"]',
      '[class*="attachment"] img',
      'img[src*="files-text.com"]',
      /* Gambar lampiran LiveChat sering berupa blob: URL — harus ikut dideteksi */
      '[class*="message"] img[src^="blob:"]',
      '[data-testid*="message"] img[src^="blob:"]',
      '[class*="chat-feed"] img[src^="blob:"]',
      /* Lazy-load: src kosong/placeholder, gambar asli menunggu di data-src */
      '[class*="message"] img[data-src*="http"]',
      '[data-testid*="message"] img[data-src*="http"]',
      '[class*="chat-feed"] img[data-src*="http"]',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var found = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < found.length; j++) imgs.push(found[j]);
    }
    return imgs;
  }

  /* ---- URL gambar terbaik (preferensi FULL-RES, bukan thumbnail feed) ----
     LiveChat feed chat menampilkan thumbnail kecil di src, sedangkan versi
     full-res ada di atribut lain (data-src/data-full/...) atau srcset terbesar.
     Thumbnail buram -> OCR akurat butuh versi full-res (sama seperti file hasil
     "Save image as..." yang diunduh browser). Prioritas: data-src (lazy-load/
     full paling umum), lalu varian atribut lain, lalu srcset terbesar, terakhir
     src. Placeholder SVG/lazy dilewati bila ada alternatif. */
  var _FULL_RES_ATTRS = ['data-src', 'data-full', 'data-full-src', 'data-original', 'data-original-src', 'data-zoom', 'data-zoom-src', 'data-large-src', 'data-hi-res', 'data-2x', 'data-image', 'data-src-big'];
  function _pickImageUrl(candidates) {
    var fallback = '';
    for (var i = 0; i < candidates.length; i++) {
      var u = candidates[i];
      if (!u) continue;
      u = String(u).trim();
      if (!u) continue;
      /* Lewati placeholder lazy-load (SVG data / data:, / about: / javascript:) */
      if (/^data:image\/svg/i.test(u) || /^data:,/.test(u) || /^(about:|javascript:)/i.test(u)) continue;
      if (u.indexOf('//') === 0) u = 'https:' + u;
      if (!/^(https?:|data:image\/|blob:)/i.test(u)) continue;
      if (!fallback) fallback = u;
      /* Preferensi: pilih kandidat yang BUKAN thumbnail bila ada */
      if (/thumb/i.test(u)) continue;
      return u;
    }
    return fallback;
  }
  function getImageUrl(imgEl) {
    if (!imgEl) return '';
    var el = imgEl;
    var candidates = [];
    var a, i;
    for (i = 0; i < _FULL_RES_ATTRS.length; i++) {
      a = el.getAttribute(_FULL_RES_ATTRS[i]);
      if (a) candidates.push(a);
    }
    /* srcset: ambil kandidat resolusi terbesar (deskriptor w/dpr paling besar) */
    var ss = el.getAttribute('srcset');
    if (ss) {
      var best = '', bestN = -1;
      var parts = String(ss).split(',');
      for (i = 0; i < parts.length; i++) {
        var m = parts[i].trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)([wx]))?$/);
        if (!m || !m[1]) continue;
        var n = m[2] ? parseFloat(m[2]) : 1;
        if (n > bestN) { bestN = n; best = m[1]; }
      }
      if (best) candidates.push(best);
    }
    candidates.push(el.getAttribute('src'));
    return _pickImageUrl(candidates);
  }

  /* Blob URL (gambar LiveChat via URL.createObjectURL) HANYA bisa dibaca dari
     origin pembuatnya (halaman LiveChat). OCR berjalan di extension page
     (offscreen/dashboard) yang CSP-nya TIDAK mengizinkan fetch blob: →
     warning CSP + gambar tidak terOCR sama sekali.
     Solusi: di konteks HALAMAN, gambar sudah termuat di <img> → salin ke canvas
     (blob same-origin → canvas TIDAK ter-taint) lalu ubah menjadi data: URL.
     data: URL diizinkan CSP extension dan sudah didukung pipeline OCR. */
  /* Cache konversi per blob URL (blob URL stabil selama object URL hidup) —
     tombol ↻ refresh tidak perlu men-encode ulang canvas setiap klik. */
  var _blobToDataUrl = {};
  function resolveImageUrl(imgEl, url) {
    return new Promise(function(resolve) {
      if (!url || url.indexOf('blob:') !== 0) { resolve(url); return; }
      if (_blobToDataUrl[url]) { resolve(_blobToDataUrl[url]); return; }
      try {
        if (!imgEl || !imgEl.naturalWidth) { resolve(url); return; }
        var c = document.createElement('canvas');
        c.width = imgEl.naturalWidth;
        c.height = imgEl.naturalHeight;
        var ctx = c.getContext('2d');
        ctx.drawImage(imgEl, 0, 0);
        var dataUrl = c.toDataURL('image/png');
        if (dataUrl && dataUrl.indexOf('data:') === 0) {
          /* Batasi cache (jangan tumbuh tak terbatas saat pindah chat) */
          var keys = Object.keys(_blobToDataUrl);
          if (keys.length > 60) { try { delete _blobToDataUrl[keys[0]]; } catch(e) {} }
          _blobToDataUrl[url] = dataUrl;
          resolve(dataUrl);
          return;
        }
      } catch(e) {}
      resolve(url);
    });
  }

  function isAvatar(imgEl) {
    if (!imgEl) return true;
    var w = imgEl.naturalWidth, h = imgEl.naturalHeight;
    /* Ukuran kecil (natural): avatar chat/daftar biasanya < 100px. Screenshot tiket
       asli jauh lebih besar (≥ ~200px) sehingga aman dilewati. */
    if (w && h) {
      if (w < 100 && h < 100) return true;
      /* Avatar PROFIL (dibuka dari header) bisa lebih besar (100–250px) tapi hampir
         selalu PESEGI (rasio mendekati 1:1). Screenshot tiket tidak persegi murni
         → tetap terdeteksi sebagai lampiran. */
      var maxd = Math.max(w, h), mind = Math.min(w, h);
      if (maxd <= 250 && (maxd / mind) < 1.35) return true;
    }
    /* Ukuran TAMPILAN kecil (sumber bisa besar tapi ditampilkan sekecil avatar):
       mis. gambar profil 400×400 yang dirender 40px. Offset 0 = belum dirender → skip. */
    var oW = imgEl.offsetWidth, oH = imgEl.offsetHeight;
    if (oW && oH && oW < 100 && oH < 100) return true;
    var src = (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '').toLowerCase();
    /* Kata kunci URL/class avatar umum di LiveChat: avatar, profile, portrait,
       gravatar, identicon, participant, visitor, agent, contact, user-photo. */
    if (/(avatar|profile|portrait|gravatar|identicon|participant|visitor|agent)/.test(src)) return true;
    var p = imgEl.parentElement;
    for (var i = 0; i < 6 && p; i++) {
      var cls = p.className || '';
      if (typeof cls === 'string' && /(avatar|profile|portrait|participant|visitor|agent|contact|sender|recipient)/i.test(cls)) return true;
      var aria = p.getAttribute && p.getAttribute('aria-label');
      if (aria && /(avatar|profile|photo)/i.test(aria)) return true;
      p = p.parentElement;
    }
    return false;
  }

  // Inject CSS theme sekali saja — paksa properti agar tidak dioverride chat
  if (!document.getElementById('lc-btn-theme')) {
    var ts = document.createElement('style');
    ts.id = 'lc-btn-theme';
    ts.textContent = [
      'div.lc-ocr-btn{all:initial;display:block!important;position:absolute!important;z-index:99999!important;padding:5px 12px!important;font-size:10px!important;font-weight:700!important;font-family:Arial,sans-serif!important;letter-spacing:.3px!important;cursor:pointer!important;border-radius:5px!important;line-height:1.3!important;pointer-events:auto!important;user-select:none!important;transition:all .15s ease!important;text-decoration:none!important;text-transform:none!important;font-style:normal!important;box-sizing:border-box!important;}',
      'div.lc-btn-bar{all:initial;display:flex!important;}',
    ].join('');
    document.head.appendChild(ts);
  }

  function addButtonToImage(imgEl) {
    if (isAvatar(imgEl)) return;

    // Jika element img dipakai ulang untuk gambar lain (src berubah saat pindah chat),
    // reset state lama agar tombol & hasil dihitung ulang untuk URL yang baru.
    var uCur = getImageUrl(imgEl);
    var uPrev = imgEl.getAttribute('data-lc-url');
    if (uCur && uPrev && uCur !== uPrev) {
      imgEl.removeAttribute('data-lc-ocr');
      imgEl.removeAttribute('data-lc-btn');
      imgEl.removeAttribute('data-lc-url');
      var nbOld = imgEl.nextSibling;
      if (nbOld && nbOld.classList && nbOld.classList.contains('lc-btn-bar')) nbOld.remove();
      var ancOld = imgEl.parentElement;
      if (ancOld) {
        var bOld = ancOld.querySelector('.lc-btn-bar');
        if (bOld) bOld.remove();
        var rOld = ancOld.querySelector('.lc-ocr-result');
        if (rOld) rOld.remove();
      }
    }

    if (imgEl.getAttribute('data-lc-ocr') === '1') return;
    imgEl.setAttribute('data-lc-ocr', '1');

    var anchor = imgEl.parentElement;
    if (!anchor) return;

    // Cegah duplikat per-image — setiap image dapat barnya sendiri di sebelahnya
    if (imgEl.getAttribute('data-lc-btn') === '1') return;

    function ensureAnchorPos() {
      var ap = window.getComputedStyle(anchor).position;
      if (ap === 'static') anchor.style.position = 'relative';
    }

    function showButton() {
      var u = getImageUrl(imgEl);
      if (!u) return;

      // Cegah duplikat per-image
      if (imgEl.getAttribute('data-lc-btn') === '1') return;

      ensureAnchorPos();
      imgEl.setAttribute('data-lc-url', u);
      var inModal = isInModal(imgEl);

      var btnBar = document.createElement('div');
      btnBar.className = 'lc-btn-bar';
      btnBar.setAttribute('data-lc-url', u);
      btnBar.style.cssText = 'display:flex !important;flex-direction:row !important;align-items:center !important;gap:4px !important;padding:4px 0 !important;pointer-events:auto !important;flex-wrap:wrap !important;' + (inModal ? 'position:absolute !important;bottom:0 !important;left:0 !important;right:0 !important;z-index:999999 !important;justify-content:center !important;background:rgba(8,11,20,0.55) !important;border-radius:0 0 4px 4px !important;' : '');

      var THEME_COLORS = {
        scan: { border: '#818cf8', text: '#818cf8', hover: 'rgba(129,140,248,0.22)' },
        crop: { border: '#a78bfa', text: '#a78bfa', hover: 'rgba(167,139,250,0.22)' },
        send: { border: '#34d399', text: '#34d399', hover: 'rgba(52,211,153,0.22)' },
      };

      function makeThemedBtn(text, title, colorSet, onClick) {
        var b = document.createElement('div');
        b.textContent = text;
        if (title) b.title = title;
        b.style.cssText = 'display:inline-block !important;padding:2px 10px !important;font-size:9px !important;font-weight:700 !important;font-family:Arial,sans-serif !important;letter-spacing:.5px !important;cursor:pointer !important;border:1px solid ' + colorSet.border + ' !important;border-radius:4px !important;color:' + colorSet.text + ' !important;background:rgba(0,0,0,0.12) !important;line-height:1.6 !important;user-select:none !important;transition:all .15s ease !important;pointer-events:auto !important;white-space:nowrap !important;';
        b.addEventListener('mouseenter', function() { b.style.background = colorSet.hover + ' !important'; });
        b.addEventListener('mouseleave', function() { b.style.background = 'rgba(0,0,0,0.12) !important'; });
        b.addEventListener('click', function(e) {
          e.stopPropagation();
          e.preventDefault();
          onClick(b);
        });
        return b;
      }

      var scanBtn = makeThemedBtn('SCAN TIKET', 'Scan tiket dengan OCR', THEME_COLORS.scan, function(b) {
        /* SCAN = gunakan hasil OCR otomatis yang sudah di-cache (prewarm) agar instant.
           Force fresh ulang tetap tersedia lewat tombol ↻ di hasil. */
        handleOcrClick(imgEl, anchor, false, false);
      });

      var cropBtn = makeThemedBtn('CROP', 'OCR dengan crop manual', THEME_COLORS.crop, function(b) {
        handleOcrClick(imgEl, anchor, true);
      });

      var sendBtn = makeThemedBtn('SEND', 'Kirim URL ke Dashboard', THEME_COLORS.send, function(b) {
        var url = getImageUrl(imgEl);
        if (!url) return;
        resolveImageUrl(imgEl, url).then(function(fetchUrl) {
          chrome.storage.local.set({ sendScanUrl: fetchUrl });
        });
        b.textContent = 'OK';
        b.style.borderColor = '#34d399 !important';
        b.style.color = '#34d399 !important';
        b.style.background = 'rgba(52,211,153,0.2) !important';
        setTimeout(function() {
          b.textContent = 'SEND';
          b.style.borderColor = THEME_COLORS.send.border + ' !important';
          b.style.color = THEME_COLORS.send.text + ' !important';
          b.style.background = 'rgba(0,0,0,0.12) !important';
        }, 1200);
      });

      btnBar.appendChild(scanBtn);
      btnBar.appendChild(cropBtn);
      btnBar.appendChild(sendBtn);

      // Tandai image ini punya btn bar
      imgEl.setAttribute('data-lc-btn', '1');

      if (inModal) {
        // Preview: overlay di atas gambar — tidak menggeser layout gambar
        imgEl.parentElement.appendChild(btnBar);
      } else {
        // Sisipkan btnBar setelah image — bukan di anchor, agar tiap image punya bar sendiri
        if (imgEl.nextSibling) {
          imgEl.parentElement.insertBefore(btnBar, imgEl.nextSibling);
        } else {
          imgEl.parentElement.appendChild(btnBar);
        }
      }

      // OCR OTOMATIS DI BELAKANG (instruksi user): hasil TIDAK ditampilkan dulu —
      // hanya di-cache (dedup _inflightOcr) agar saat tombol SCAN TIKET ditekan
      // hasil sudah siap → terasa instant. Cache tetap dipakai saat pindah chat.
      prewarmOcr(imgEl, u);

      /* Cari semua gambar lain yang belum diproses */
      scanForImages();
    }

    if (imgEl.complete && imgEl.naturalWidth > 0) {
      showButton();
    } else {
      imgEl.addEventListener('load', showButton);
    }
  }

  /* Pre-warm iframe OCR sejak awal halaman — mode CROP & SCAN tidak perlu
     menunggu pembuatan iframe + muat HTML pertama kali (terasa instant). */
  function warmOcrIframe() {
    try {
      ensureIframe().catch(function() {});
    } catch(e) {}
  }

  function handleOcrClick(imgEl, anchor, cropMode, forceFresh) {
    var url = getImageUrl(imgEl);
    if (!url) return;

    var existing = anchor.querySelector('.lc-ocr-result');
    if (existing) existing.remove();

    /* Blob URL (gambar LiveChat) tidak bisa di-fetch dari extension page (CSP) —
       resolve ke data URL di konteks halaman dulu, baru kirim ke OCR. */
    if (cropMode) {
      /* CROP = INSTANT: tampilkan UI crop dulu; resolve blob → data URL berjalan
         di belakang (encode canvas bisa 100-500ms untuk gambar besar) — gambar
         terisi di dalam crop begitu data URL siap. */
      runLcCrop(url, anchor, imgEl);
      return;
    }
    resolveImageUrl(imgEl, url).then(function(fetchUrl) {
      /* Cache 10 menit: tampilkan hasil segar langsung, ↻ (forceFresh) paksa scan ulang */
      runLcOcr(url, anchor, forceFresh, fetchUrl);
    });
  }

  function showLcResult(anchor, result, url) {
    if (!anchor.isConnected) {
      // Anchor terputus (chat re-render) — cari ulang gambar dengan URL yang sama, tanpa cache
      try {
        var imgs = document.querySelectorAll('img[data-lc-ocr="1"]');
        for (var i = 0; i < imgs.length; i++) {
          if (getImageUrl(imgs[i]) === url && imgs[i].parentElement && imgs[i].parentElement.isConnected) {
            var anc2 = imgs[i].parentElement;
            if (!anc2.querySelector('.lc-ocr-result')) { showLcResult(anc2, result, url); }
            return;
          }
        }
      } catch(e) {}
      return;
    }
    if (result.isAllText) showOcrResultAll(anchor, result, url);
    else showOcrResult(anchor, result, url);
  }

  function createLcLoadingOverlay(anchor) {
    var overlay = document.createElement('div');
    overlay.className = 'lc-ocr-result';
    overlay.style.cssText = [
      'display:block !important',
      'position:absolute !important',
      'bottom:0 !important',
      'left:0 !important',
      'right:0 !important',
      'z-index:99999 !important',
      'background:rgba(0,0,0,0.85) !important',
      'color:#fff !important',
      'padding:6px 8px !important',
      'font-size:11px !important',
      'font-family:Arial,sans-serif !important',
      'line-height:1.4 !important',
      'text-align:center !important',
      'pointer-events:auto !important',
    ].join('');
    overlay.innerHTML = '<div style="position:relative;display:inline-block;padding:6px 16px;background:rgba(8,11,20,0.95);border-radius:4px;color:#fff;">' +
      '<span style="position:absolute;top:-4px;left:-4px;width:10px;height:10px;border-top:2px solid #facc15;border-left:2px solid #facc15;border-radius:2px 0 0 0;pointer-events:none;"></span>' +
      '<span style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-top:2px solid #facc15;border-right:2px solid #facc15;border-radius:0 2px 0 0;pointer-events:none;"></span>' +
      '<span style="position:absolute;bottom:-4px;left:-4px;width:10px;height:10px;border-bottom:2px solid #facc15;border-left:2px solid #facc15;border-radius:0 0 0 2px;pointer-events:none;"></span>' +
      '<span style="position:absolute;bottom:-4px;right:-4px;width:10px;height:10px;border-bottom:2px solid #facc15;border-right:2px solid #facc15;border-radius:0 0 2px 0;pointer-events:none;"></span>' +
      'Loading...</div>';
    anchor.appendChild(overlay);
    return overlay;
  }

  /* OCR OTOMATIS TANPA TAMPIL — hasil di-cache dulu (pakai dedup _inflightOcr yang
     sama dengan runLcOcr) sehingga saat tombol SCAN TIKET ditekan hasil sudah siap
     → terasa instant. Tidak menampilkan apa pun di halaman. */
  function prewarmOcr(imgEl, url) {
    if (!url) return;
    if (ocrCacheGet(url)) return;      /* sudah punya hasil — jangan scan ulang */
    if (_inflightOcr[url]) return;     /* scan sedang berjalan — cukup tunggu cache */
    resolveImageUrl(imgEl, url).then(function(fetchUrl) {
      if (ocrCacheGet(url)) return;
      if (_inflightOcr[url]) return;
      var p = runOcr(url, fetchUrl);
      _inflightOcr[url] = p;
      p.then(function(result) {
        delete _inflightOcr[url];
        ocrCacheSet(url, result);
      });
    });
  }

  function runLcOcr(url, anchor, forceFresh, fetchUrl) {
    /* Instruksi user: waktu dihitung sejak tombol SCAN ditekan, BUKAN sejak OCR
       otomatis (prewarm) dijalankan di latar belakang. Untuk hasil instant dari
       cache, elapsed = ~0.0s; untuk hasil yang masih menunggu, elapsed = lama
       menunggu dari klik. Override elapsed di salinan hasil (tidak mengubah cache). */
    var scanStart = Date.now();
    function finalize(result) {
      if (result && !result.error) {
        result = Object.assign({}, result, { elapsed: ((Date.now() - scanStart) / 1000).toFixed(1) });
      }
      showLcResult(anchor, result, url);
    }
    // Cache 10 menit — tampilkan hasil segar langsung (kecuali dipaksa scan ulang)
    if (!forceFresh) {
      var cached = ocrCacheGet(url);
      if (cached && !anchor.querySelector('.lc-ocr-result')) {
        finalize(cached);
        return;
      }
    }
    /* Dedup: scan untuk URL yang sama sedang berjalan → tunggu hasil yang sama */
    if (_inflightOcr[url]) {
      createLcLoadingOverlay(anchor);
      _inflightOcr[url].then(finalize);
      return;
    }
    createLcLoadingOverlay(anchor);
    var p = runOcr(url, fetchUrl);
    _inflightOcr[url] = p;
    p.then(function(result) {
      delete _inflightOcr[url];
      ocrCacheSet(url, result);
      finalize(result);
    });
  }

  /* Preview: tampilkan hasil OCR di modal, atau jalankan otomatis jika belum ada */
  function handleModalImage(modalImg) {
    var u = getImageUrl(modalImg);
    if (!u) return;
    var anchor = modalImg.parentElement;
    if (!anchor) return;
    var cached = ocrCacheGet(u);
    if (cached) {
      if (!anchor.querySelector('.lc-ocr-result')) showLcResult(anchor, cached, u);
      return;
    }
    if (!anchor.querySelector('.lc-ocr-result')) {
      resolveImageUrl(modalImg, u).then(function(fetchUrl) { runLcOcr(u, anchor, undefined, fetchUrl); });
    }
  }

  function runLcCrop(url, anchor, imgEl) {
    createLcLoadingOverlay(anchor);

    // Crop mode: buat iframe visible dulu, kirim OCR_RUN dengan cropMode
    // Inject animasi style sekali saja
    if (!document.getElementById('lc-crop-style')) {
      var cs = document.createElement('style');
      cs.id = 'lc-crop-style';
      cs.textContent = '@keyframes lcFadeIn{from{opacity:0}}@keyframes lcFadeOut{to{opacity:0}}#lc-crop-overlay{animation:lcFadeIn .15s ease both}';
      document.head.appendChild(cs);
    }

    var cropOverlay = document.createElement('div');
    cropOverlay.id = 'lc-crop-overlay';
    cropOverlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.5);';
    document.body.appendChild(cropOverlay);

    // Show iframe for crop — iframe sudah di-warm sejak awal (lihat init),
    // jadi langsung fullscreen tanpa fade delay yang terasa.
    ensureIframe().then(function(src) {
      var iframe = document.querySelector('iframe[src*="ocr-frame"]');
      if (iframe) {
        // Tampil instan (iframe sudah pre-loaded); overlay crop di dalamnya
        // punya fade 0.15s sendiri agar tetap smooth tanpa terasa lambat.
        iframe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;border:none;background:transparent;pointer-events:auto;opacity:1;transition:none;';
      }

      var ocrReqId = getReqId();
      if (!pendingResults[ocrReqId]) pendingResults[ocrReqId] = [];

      /* ESC = BATAL (instruksi user). Parent menangkap ESC karena iframe crop
         tidak selalu punya fokus keyboard (fokus masih di halaman livechat bila
         user belum klik di dalam iframe — handler ESC di iframe tidak akan pernah
         menyala). Diteruskan ke iframe → doCancel → OCR_RESULT cancelled →
         closeCrop() — jalur yang sama persis dengan tombol Batal. */
      var cropEscHandler = function(ev) {
        if (ev.key !== 'Escape') return;
        if (!document.getElementById('lc-crop-overlay')) return;
        ev.preventDefault();
        try { src.postMessage({ type: 'OCR_CROP_CANCEL', reqId: ocrReqId }, '*'); } catch(e2) {}
      };
      document.addEventListener('keydown', cropEscHandler, true);

      var closeCrop = function(keepResult) {
        document.removeEventListener('keydown', cropEscHandler, true);
        // Fade out overlay
        var ov = document.getElementById('lc-crop-overlay');
        if (ov) {
          ov.style.animation = 'lcFadeOut .2s ease both';
          setTimeout(function() { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 220);
        }
        // Fade out iframe
        if (iframe) {
          iframe.style.opacity = '0';
          iframe.style.pointerEvents = 'none';
          setTimeout(function() {
            iframe.style.cssText = 'visibility:hidden;position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;border:none;opacity:0;';
          }, 250);
        }
      };

      // Timeout: auto-cancel setelah 120 detik
      var cropTimer = setTimeout(function() {
        delete pendingResults[ocrReqId];
        closeCrop();
      }, 120000);

      pendingResults[ocrReqId].push(function(result) {
        clearTimeout(cropTimer);
        closeCrop();

        if (result.cancelled) {
          // Hapus loading overlay dari anchor — jangan sampai stuck Loading...
          var loadingEl = anchor.querySelector('.lc-ocr-result');
          if (loadingEl) loadingEl.remove();
          return;
        }

        // Cache hasil crop (kode 10 mnt / NAMA-RRN 30 mnt) — tidak hilang saat pindah chat
        ocrCacheSet(url, result);
        showLcResult(anchor, result, url);
      });

      // Send OCR_RUN with cropMode (blob → data URL agar bisa dimuat iframe/OCR).
      // Resolve di belakang — shell crop sudah tampil, gambar terisi saat siap.
      resolveImageUrl(imgEl, url).then(function(fetchUrl) {
        try { src.postMessage({ type: 'OCR_RUN', url: fetchUrl || url, reqId: ocrReqId, cropMode: true }, '*'); } catch(e2) {}
      });
    }).catch(function() {
      var ov = document.getElementById('lc-crop-overlay');
      if (ov) ov.remove();
    });
  }

  function cleanupOrphanedBars() {
    var bars = document.querySelectorAll('.lc-btn-bar');
    for (var bi = 0; bi < bars.length; bi++) {
      var bar = bars[bi];
      // Hapus bar jika sudah tidak terhubung ke DOM
      if (!bar.isConnected) {
        bar.remove();
        continue;
      }
      var url = bar.getAttribute('data-lc-url');
      if (url) {
        // Bar valid jika masih ada img terhubung dengan URL yang sama
        var stillValid = false;
        var allImg = document.querySelectorAll('img[data-lc-url]');
        for (var ii = 0; ii < allImg.length; ii++) {
          if (allImg[ii].isConnected && allImg[ii].getAttribute('data-lc-url') === url) { stillValid = true; break; }
        }
        if (stillValid) continue;
      } else {
        // Fallback: bar setelah image (layout chat lama)
        var prev = bar.previousElementSibling;
        var hasBtnImage = prev && prev.tagName === 'IMG' && prev.getAttribute('data-lc-btn') === '1' && prev.isConnected;
        if (hasBtnImage) continue;
      }
      bar.remove();
    }
  }

  function scanForImages() {
    // Bersihkan button bar yang sudah tidak dipakai (misal saat pindah chat)
    cleanupOrphanedBars();

    var modalImg = findImageModal();
    if (modalImg && !isAvatar(modalImg)) {
      /* Modal preview (gambar diklik): tandai + hasilnya otomatis unhide.
         findImageModal MATCH selector modal (dialog/overlay/preview/lightbox) →
         sinyal andal, tidak perlu menebak class DOM preview. */
      modalImg.setAttribute('data-lc-modalimg', '1');
      addButtonToImage(modalImg);
      handleModalImage(modalImg);
      try {
        var mRes = modalImg.parentElement ? modalImg.parentElement.querySelector('.lc-ocr-result') : null;
        if (mRes) _lcSetMore(mRes, true);
      } catch(e) {}
    }

    var chatImgs = findChatImages();
    for (var i = 0; i < chatImgs.length; i++) {
      /* Gambar di feed → bukan modal: bersihkan flag modal agar render berikutnya
         collapse lagi (mencegah data-lc-modalimg bocor ke feed). */
      chatImgs[i].removeAttribute('data-lc-modalimg');
      addButtonToImage(chatImgs[i]);
    }

    /* Konteks feed ↔ modal preview (instruksi user): gambar diklik (modal) →
       otomatis unhide; keluar modal → kembali collapse. Hanya merespons PERUBAHAN
       state modal (data-lc-modal), tidak mengganggu toggle manual. */
    try {
      var taggedImgs = document.querySelectorAll('img[data-lc-ocr="1"]');
      for (var ti = 0; ti < taggedImgs.length; ti++) {
        var tImg = taggedImgs[ti];
        if (!tImg.isConnected || !tImg.parentElement) continue;
        var tAnchor = tImg.parentElement;
        var tRes = tAnchor.querySelector('.lc-ocr-result');
        if (!tRes) continue;
        var nowModal = isInModal(tAnchor) ? '1' : '0';
        var wasModal = tRes.getAttribute('data-lc-modal') || '';
        if (nowModal !== wasModal) {
          tRes.setAttribute('data-lc-modal', nowModal);
          _lcSetMore(tRes, nowModal === '1');
        }
      }
    } catch(e) {}
  }

  /* === Shared pick/remove functions === */
  var _lcUserInput, _lcKodeInput, _lcKode2Input, _lcBtn2x, _lcDualMode = false, _lcOverlayPick = '', _lcSubmitting = false, _lcRestoring = false, _lcAutoAmbil = false;
  var _lcTryAdd = null; /* referensi tryLcAdd untuk dipanggil ulang setelah refreshPanel */

  function _ocrPickKey(url) { return 'ocr_pick_' + btoa(url || '').replace(/[+/=]/g, '').substring(0, 40); }
  function _markPicked(url, code) {
    try { chrome.storage.local.get(_ocrPickKey(url), function(r) {
      var list = r[_ocrPickKey(url)] || [];
      if (list.indexOf(code) === -1) list.push(code);
      chrome.storage.local.set({ [_ocrPickKey(url)]: list });
    }); } catch(e) {}
  }
  function _unmarkPicked(url, code) {
    try { chrome.storage.local.get(_ocrPickKey(url), function(r) {
      var list = r[_ocrPickKey(url)] || [];
      var idx = list.indexOf(code);
      if (idx >= 0) list.splice(idx, 1);
      chrome.storage.local.set({ [_ocrPickKey(url)]: list });
    }); } catch(e) {}
  }
  function _getPickedCodes(url, cb) {
    try { chrome.storage.local.get(_ocrPickKey(url), function(r) { cb(r[_ocrPickKey(url)] || []); }); } catch(e) { cb([]); }
  }
  function _setLcInput(el, val) {
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function _lcPick(code, fromOverlay) {
    if (!code || code.length < 19) return;
    if (fromOverlay) {
      if (code === _lcOverlayPick) return;
      if (!_lcOverlayPick) {
        _setLcInput(_lcKodeInput, code);
        if (!_lcDualMode) {
          _setLcInput(_lcKode2Input, '');
          if (_lcBtn2x) {
            _lcDualMode = false;
            _lcBtn2x.classList.remove('active');
            _lcBtn2x.style.background = 'rgba(99,102,241,0.15)';
            _lcBtn2x.style.color = '#818cf8';
            var _kw = document.getElementById('lc-kode-2-wrap');
            if (_kw) _kw.style.display = 'none';
          }
        }
        _lcOverlayPick = code;
      } else {
        if (!_lcDualMode && _lcBtn2x) _lcBtn2x.click();
        _setLcInput(_lcKode2Input, code);
      }
    } else {
      if (_lcKodeInput && _lcKodeInput.value && _lcKodeInput.value !== code) {
        if (_lcKode2Input && _lcKode2Input.value === code) return;
        if (!_lcDualMode && _lcBtn2x) _lcBtn2x.click();
        _setLcInput(_lcKode2Input, code);
      } else {
        _setLcInput(_lcKodeInput, code);
      }
    }
  }
  function _lcRemove(code) {
    if (!code || code.length < 19) return;
    if (_lcKodeInput && _lcKodeInput.value === code) { _setLcInput(_lcKodeInput, ''); _lcOverlayPick = ''; }
    if (_lcKode2Input && _lcKode2Input.value === code) _setLcInput(_lcKode2Input, '');
  }

  /* === Panel Livechat (User ID & Kode Tiket) === */
  function initPanel() {
    if (document.getElementById('lc-panel')) return;

    var panel = document.createElement('div');
    panel.id = 'lc-panel';
    panel.style.cssText = 'position:fixed;top:95px;right:0;width:230px;z-index:999999;transition:right 0.2s ease;background:rgba(15,23,42,0.35);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:10px 14px;box-sizing:border-box;font-family:Arial,sans-serif;border:1px solid rgba(99,102,241,0.1);border-right:none;border-radius:8px 0 0 8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
    panel.dataset.hidden = 'false';

    var toggleBtn = document.createElement('div');
    toggleBtn.id = 'lc-toggle-btn';
    toggleBtn.textContent = '\u25B6';
    toggleBtn.style.cssText = 'position:absolute;left:-18px;top:10px;width:16px;height:24px;background:rgba(15,23,42,0.5);backdrop-filter:blur(6px);border:1px solid rgba(99,102,241,0.1);border-right:none;border-radius:4px 0 0 4px;color:#818cf8;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    toggleBtn.addEventListener('click', function() {
      var hidden = panel.dataset.hidden === 'true';
      panel.dataset.hidden = hidden ? 'false' : 'true';
      panel.style.right = hidden ? '0' : '-230px';
      toggleBtn.textContent = hidden ? '\u25B6' : '\u25C0';
    });
    panel.appendChild(toggleBtn);

    var contentWrap = document.createElement('div');
    panel.appendChild(contentWrap);

    /* Banner notifikasi Reject / Not Found — di ATAS panel agar terlihat jelas
       (instruksi user: alert reject & notfound kurang terlihat). Berkedip,
       klik untuk tutup sementara 30 detik. */
    var _lcAlertDismiss = 0;
    var alertBanner = document.createElement('div');
    alertBanner.id = 'lc-alert-banner';
    alertBanner.style.cssText = 'display:none;margin-bottom:6px;padding:6px 8px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.3px;line-height:1.4;cursor:pointer;user-select:none;background:rgba(239,68,68,0.18);border:1px solid rgba(239,68,68,0.5);color:#fecaca;';
    alertBanner.addEventListener('click', function() {
      _lcAlertDismiss = Date.now() + 30000; /* tutup sementara 30 dtk */
      alertBanner.style.display = 'none';
    });
    panel.insertBefore(alertBanner, contentWrap);

    var title = document.createElement('div');
    title.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    var titleText = document.createElement('span');
    titleText.textContent = 'LIVECHAT';
    titleText.style.cssText = 'font-size:10px;font-weight:700;color:#818cf8;text-transform:uppercase;letter-spacing:1px;';
    title.appendChild(titleText);
    var clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.title = 'Hapus semua kolom';
    clearBtn.style.cssText = 'cursor:pointer;color:#64748b;font-size:9px;padding:2px 8px;border-radius:3px;border:1px solid rgba(100,116,139,0.3);background:rgba(100,116,139,0.08);transition:all .15s;line-height:1;font-weight:600;letter-spacing:.3px;';
    clearBtn.addEventListener('mouseenter', function() { clearBtn.style.color = '#ef4444'; clearBtn.style.background = 'rgba(239,68,68,0.12)'; clearBtn.style.borderColor = 'rgba(239,68,68,0.3)'; });
    clearBtn.addEventListener('mouseleave', function() { clearBtn.style.color = '#64748b'; clearBtn.style.background = 'rgba(100,116,139,0.08)'; clearBtn.style.borderColor = 'rgba(100,116,139,0.3)'; });
    clearBtn.addEventListener('click', function() {
      _setLcInput(userInput, '');
      _setLcInput(kodeInput, '');
      _setLcInput(kode2Input, '');
      _lcOverlayPick = '';
      _lcDualMode = false;
      if (btn2x) { btn2x.classList.remove('active'); btn2x.style.background = 'rgba(99,102,241,0.15)'; btn2x.style.color = '#818cf8'; }
      kode2Wrap.style.display = 'none';
      statusEl.textContent = 'Dihapus';
      statusEl.style.color = '#94a3b8';
      setTimeout(function() { statusEl.textContent = ''; }, 1200);
    });
    title.appendChild(clearBtn);
    contentWrap.appendChild(title);

    var userLabel = document.createElement('div');
    userLabel.textContent = 'User ID';
    userLabel.style.cssText = 'font-size:9px;color:#94a3b8;margin-bottom:2px;';
    contentWrap.appendChild(userLabel);

    var userRow = document.createElement('div');
    userRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:6px;';

    var userInput = document.createElement('input');
    userInput.id = 'lc-user';
    userInput.type = 'text';
    userInput.placeholder = 'User ID';
    userInput.autocomplete = 'off';
    userInput.style.cssText = 'flex:1;padding:6px 8px;font-size:11px;background:rgba(255,255,255,0.06);color:#e2e8f0;border:1px solid rgba(99,102,241,0.12);border-radius:4px;outline:none;box-sizing:border-box;';
    userRow.appendChild(userInput);
    _lcUserInput = userInput;

    var btn2x = document.createElement('button');
    btn2x.id = 'lc-btn-2x';
    btn2x.tabIndex = -1;
    btn2x.textContent = '2x';
    btn2x.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:700;background:rgba(99,102,241,0.15);color:#818cf8;border:1px solid rgba(99,102,241,0.2);border-radius:4px;cursor:pointer;flex-shrink:0;letter-spacing:.5px;';
    userRow.appendChild(btn2x);
    _lcBtn2x = btn2x;

    contentWrap.appendChild(userRow);

    var kodeLabel = document.createElement('div');
    kodeLabel.textContent = 'Kode Tiket';
    kodeLabel.style.cssText = 'font-size:9px;color:#94a3b8;margin-bottom:2px;';
    contentWrap.appendChild(kodeLabel);

    var kodeInput = document.createElement('input');
    kodeInput.id = 'lc-kode';
    kodeInput.type = 'text';
    kodeInput.placeholder = 'Kode Tiket';
    kodeInput.autocomplete = 'off';
    kodeInput.style.cssText = 'width:100%;padding:6px 8px;font-size:11px;background:rgba(255,255,255,0.06);color:#e2e8f0;border:1px solid rgba(99,102,241,0.12);border-radius:4px;outline:none;box-sizing:border-box;margin-bottom:2px;';
    contentWrap.appendChild(kodeInput);
    _lcKodeInput = kodeInput;

    var kode2Wrap = document.createElement('div');
    kode2Wrap.id = 'lc-kode-2-wrap';
    kode2Wrap.style.display = 'none';
    var kode2Input = document.createElement('input');
    kode2Input.id = 'lc-kode-2';
    kode2Input.type = 'text';
    kode2Input.placeholder = 'Kode Tiket 2';
    kode2Input.autocomplete = 'off';
    kode2Input.style.cssText = 'width:100%;padding:6px 8px;font-size:11px;background:rgba(255,255,255,0.06);color:#e2e8f0;border:1px solid rgba(99,102,241,0.12);border-radius:4px;outline:none;box-sizing:border-box;margin-bottom:4px;';
    kode2Wrap.appendChild(kode2Input);
    contentWrap.appendChild(kode2Wrap);
    _lcKode2Input = kode2Input;

    /* === Password Generator (spt dashboard) === */
    var passToggle = document.createElement('div');
    passToggle.id = 'lc-pass-toggle';
    passToggle.textContent = 'PASSWORD  ▼';
    passToggle.style.cssText = 'font-size:9px;font-weight:700;color:#94a3b8;cursor:pointer;margin-top:4px;letter-spacing:.5px;user-select:none;';

    var passWrap = document.createElement('div');
    passWrap.style.display = 'none';

    var genUser = document.createElement('input');
    genUser.id = 'lc-gen-user';
    genUser.type = 'text';
    genUser.placeholder = 'Generate password — tempel User ID';
    genUser.autocomplete = 'off';
    genUser.style.cssText = 'width:100%;padding:6px 8px;font-size:11px;background:rgba(255,255,255,0.06);color:#e2e8f0;border:1px solid rgba(99,102,241,0.12);border-radius:4px;outline:none;box-sizing:border-box;';

    var genResult = document.createElement('div');
    genResult.style.display = 'none';

    function _genPwd() {
      var u = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', l = 'abcdefghijklmnopqrstuvwxyz', d = '0123456789', a = u + l + d;
      var p = '';
      p += u[Math.floor(Math.random() * u.length)];
      p += l[Math.floor(Math.random() * l.length)];
      p += d[Math.floor(Math.random() * d.length)];
      for (var i = 3; i < 8; i++) p += a[Math.floor(Math.random() * a.length)];
      return p.split('').sort(function() { return Math.random() - 0.5; }).join('');
    }

    function showGenResult(val, password) {
      genResult.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;"><span style="color:#64748b;min-width:60px;font-size:10px;">User ID :</span><span style="color:#e2e8f0;font-weight:700;font-size:12px;">' + escapeHtml(val) + '</span></div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;"><span style="color:#64748b;min-width:60px;font-size:10px;">Password :</span><span style="color:#e2e8f0;font-weight:700;font-family:Consolas,monospace;font-size:13px;letter-spacing:1px;" class="lc-pw-display">' + escapeHtml(password) + '</span>' +
        '<button style="margin-left:auto;padding:3px 8px;font-size:9px;font-weight:600;background:linear-gradient(135deg,#3b82f6,#60a5fa);color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;" class="lc-pw-copy-btn">Salin Sandi</button></div>' +
        '<div style="color:#fcd34d;margin-top:4px;font-size:10px;">Silahkan dicoba login dan segera diganti passwordnya ya bosku</div>' +
        '<button style="margin-top:6px;padding:3px 10px;font-size:9px;font-weight:600;background:linear-gradient(135deg,#a78bfa,#7c3aed);color:#fff;border:none;border-radius:4px;cursor:pointer;" class="lc-pw-copy-all">Salin Data</button>';
      genResult.style.display = 'block';

      /* wire copy buttons */
      var _pwCopyTimer = null;
      var copyBtn = genResult.querySelector('.lc-pw-copy-btn');
      var copyAll = genResult.querySelector('.lc-pw-copy-all');
      if (copyBtn) copyBtn.addEventListener('click', function() {
        var pw = genResult.querySelector('.lc-pw-display');
        if (!pw) return;
        var ta = document.createElement('textarea');
        ta.value = pw.textContent; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        copyBtn.textContent = 'Tersalin!';
        if (_pwCopyTimer) clearTimeout(_pwCopyTimer);
        _pwCopyTimer = setTimeout(function() { copyBtn.textContent = 'Salin Sandi'; }, 2000);
      });
      if (copyAll) copyAll.addEventListener('click', function() {
        var lines = genResult.querySelectorAll('div');
        var uidText = '', pwText = '';
        for (var i = 0; i < lines.length; i++) {
          var spans = lines[i].querySelectorAll('span');
          if (spans.length >= 2) {
            var label = spans[0].textContent.trim();
            if (label.indexOf('User ID') >= 0) uidText = spans[1].textContent;
            if (label.indexOf('Password') >= 0) pwText = spans[1].textContent;
          }
        }
        var full = 'User ID : ' + uidText + '\nPassword : ' + pwText + '\n\nSilahkan dicoba login dan segera diganti passwordnya ya bosku';
        var ta = document.createElement('textarea');
        ta.value = full; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        copyAll.textContent = 'Tersalin!';
        if (_pwCopyTimer) clearTimeout(_pwCopyTimer);
        _pwCopyTimer = setTimeout(function() { copyAll.textContent = 'Salin Data'; }, 2000);
      });
    }

    passWrap.appendChild(genUser);
    passWrap.appendChild(genResult);

    genUser.addEventListener('input', function() {
      var val = genUser.value.trim();
      if (!val || val.indexOf(' ') >= 0 || val.length < 4) {
        genResult.innerHTML = '';
        genResult.style.display = 'none';
        return;
      }
      showGenResult(val, _genPwd());
    });

    var passOpen = false;
    passToggle.addEventListener('click', function() {
      passOpen = !passOpen;
      passWrap.style.display = passOpen ? 'block' : 'none';
      passToggle.textContent = passOpen ? 'PASSWORD  ▲' : 'PASSWORD  ▼';
    });

    _lcDualMode = false;
    btn2x.addEventListener('click', function() {
      _lcDualMode = !_lcDualMode;
      btn2x.classList.toggle('active', _lcDualMode);
      btn2x.style.background = _lcDualMode ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.15)';
      btn2x.style.color = _lcDualMode ? '#c7d2fe' : '#818cf8';
      kode2Wrap.style.display = _lcDualMode ? 'block' : 'none';
      if (!_lcDualMode) { _setLcInput(kode2Input, ''); }
    });

    /* status message */
    var statusEl = document.createElement('div');
    statusEl.id = 'lc-status';
    statusEl.style.cssText = 'font-size:9px;color:#64748b;min-height:8px;margin-top:2px;';
    contentWrap.appendChild(statusEl);

    /* Row stats + Auto Ambil */
    var statsWrap = document.createElement('div');
    statsWrap.id = 'lc-stats';
    statsWrap.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:3px 6px;font-size:8px;letter-spacing:.3px;';
    contentWrap.appendChild(statsWrap);

    var statsText = document.createElement('span');
    statsText.style.cssText = 'display:flex;align-items:center;gap:4px 6px;flex-wrap:wrap;';
    statsWrap.appendChild(statsText);

    /* Auto Ambil toggle — inline with stats */
    var autoAmbilWrap = document.createElement('div');
    autoAmbilWrap.style.cssText = 'display:flex;align-items:center;gap:3px;margin-left:auto;flex-shrink:0;cursor:pointer;';
    var autoAmbilLabel = document.createElement('span');
    autoAmbilLabel.style.cssText = 'font-size:7px;color:#94a3b8;letter-spacing:.3px;user-select:none;white-space:nowrap;';
    autoAmbilLabel.textContent = '+Ambil';
    var autoAmbilSwitch = document.createElement('div');
    autoAmbilSwitch.style.cssText = 'width:22px;height:11px;border-radius:6px;cursor:pointer;position:relative;transition:background .2s;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.2);';
    var autoAmbilDot = document.createElement('div');
    autoAmbilDot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#64748b;position:absolute;top:1px;left:1px;transition:left .2s,background .2s;';
    autoAmbilSwitch.appendChild(autoAmbilDot);
    autoAmbilWrap.appendChild(autoAmbilLabel);
    autoAmbilWrap.appendChild(autoAmbilSwitch);
    statsWrap.appendChild(autoAmbilWrap);

    function refreshStats() {
      try { chrome.storage.local.get('rows', function(r) {
        var rows = r.rows || [];
        var approved = 0, rejected = 0, pending = 0, notfound = 0;
        var alertCodes = [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (row.autoStatus === 'APPROVED') approved++;
          else if (row.autoStatus === 'REJECTED') { rejected++; alertCodes.push((row.kodeTiket || row.kode || '').slice(0, 8) + '…'); }
          else if (row.manualStatus === 'Ticket Not Found' || row.manualStatus === 'Session Timeout' || row.autoCol10 === 'Tidak Ditemukan Scatter' || row.autoCol10 === 'Scatter Not Found') { notfound++; alertCodes.push((row.kodeTiket || row.kode || '').slice(0, 8) + '…'); }
          else pending++;
        }
        var blinkReject = rejected > 0 ? 'animation:lcBlink 1s infinite;' : '';
        var blinkNF = notfound > 0 ? 'animation:lcBlink 1s infinite;' : '';
        var warn = (rejected > 0 || notfound > 0) ? '<span style="color:#ef4444;font-size:10px;animation:lcBlink 1s infinite;" title="' + rejected + ' Reject, ' + notfound + ' Not Found">&#9888;</span>' : '';
        statsText.innerHTML = warn +
          '<span style="color:#4ade80;">✓ ' + approved + '</span>' +
          '<span style="color:#f87171;' + blinkReject + '">✗ ' + rejected + '</span>' +
          '<span style="color:#facc14;">⟳ ' + pending + '</span>' +
          '<span style="color:#94a3b8;' + blinkNF + '">! ' + notfound + '</span>';
        /* Banner notifikasi di atas panel — muncul saat ada Reject/Not Found */
        var alertMsgs = [];
        if (rejected > 0) alertMsgs.push('<b>' + rejected + ' Reject</b>');
        if (notfound > 0) alertMsgs.push('<b>' + notfound + ' Not Found</b>');
        if (alertMsgs.length && Date.now() > _lcAlertDismiss) {
          alertBanner.style.display = 'block';
          alertBanner.innerHTML = '&#9888; <span style="animation:lcBlink 1s infinite;">' + alertMsgs.join(' · ') + '</span>';
          alertBanner.title = 'Klik untuk tutup 30 dtk · ' + (alertCodes.slice(0, 6).join(', ') || '');
        } else if (!alertMsgs.length) {
          _lcAlertDismiss = 0;
          alertBanner.style.display = 'none';
        }
      }); } catch(e) {}
    }

    if (!document.getElementById('lc-blink-style')) {
      var s = document.createElement('style');
      s.id = 'lc-blink-style';
      s.textContent = '@keyframes lcBlink{0%,100%{opacity:1}50%{opacity:0.2}}';
      document.head.appendChild(s);
    }
    refreshStats();
    setInterval(refreshStats, 5000);

    function updateAutoAmbilUI() {
      if (_lcAutoAmbil) {
        autoAmbilSwitch.style.background = 'rgba(99,102,241,0.4)';
        autoAmbilDot.style.left = '13px';
        autoAmbilDot.style.background = '#818cf8';
      } else {
        autoAmbilSwitch.style.background = 'rgba(99,102,241,0.15)';
        autoAmbilDot.style.left = '1px';
        autoAmbilDot.style.background = '#64748b';
      }
    }

    function toggleAutoAmbil() {
      _lcAutoAmbil = !_lcAutoAmbil;
      updateAutoAmbilUI();
      try { chrome.storage.local.set({ lcAutoAmbil: _lcAutoAmbil }); } catch(e) {}
    }

    autoAmbilSwitch.addEventListener('click', toggleAutoAmbil);
    autoAmbilLabel.addEventListener('click', toggleAutoAmbil);

    updateAutoAmbilUI();

    try { chrome.storage.local.get('lcAutoAmbil', function(r) { if (r.lcAutoAmbil !== undefined) { _lcAutoAmbil = !!r.lcAutoAmbil; updateAutoAmbilUI(); } }); } catch(e) {}

    contentWrap.appendChild(passToggle);
    contentWrap.appendChild(passWrap);

    document.body.appendChild(panel);

    /* --- Init: scan gambar baru dan pantau perubahan --- */
    scanForImages();
    var _lcObsTimer = null;
    var _lcObserver = new MutationObserver(function() {
      clearTimeout(_lcObsTimer);
      _lcObsTimer = setTimeout(scanForImages, 500);
    });
    _lcObserver.observe(document.body, { childList: true, subtree: true });

    /* auto-execute when user + kode filled — triggers manual + auto processing like dashboard & popup */
    function tryLcAdd() {
      _lcTryAdd = tryLcAdd; /* expose agar refreshPanel bisa auto-submit ulang data yang dipulihkan */
      if (_lcSubmitting || _lcRestoring) return;
      var u = userInput.value.trim();
      var k = kodeInput.value.trim();
      if (!u || !k) return;
      if (_lcDualMode && !kode2Input.value.trim()) return;
      var kc = k.replace(/[^a-zA-Z0-9]/g, '').trim();
      if (kc.length < 19) return;
      /* Snapshot nilai yang disubmit — jangan kosongkan field yang sudah diubah
         user dengan data BARU selama proses async (cegah data terskip). */
      var snapU = u, snapK = k, snapK2 = kode2Input.value.trim();
      _lcSubmitting = true;
      try { chrome.storage.local.get(['rows', 'nextRowId'], function(r) {
        _lcRows = r.rows || [];
        _lcNextId = r.nextRowId || 1;
        var k2 = snapK2;
        var k2c = k2 ? k2.replace(/[^a-zA-Z0-9]/g, '').trim() : '';
        if (k2c && k2c.length < 19) { statusEl.textContent = 'Kode 2 < 19 karakter!'; statusEl.style.color = '#ef4444'; _lcSubmitting = false; return; }
        var parsed = (function(s) { var r = (s||'').trim(), m = r.match(/\s+(ts\s*.*)$/i), ts = m ? m[1] : ''; r = r.replace(/\s+ts\s*.*/i, '').replace(/\s+/g, '').trim(); return { user: r, hasTS: !!m }; })(u);
        if (!parsed.user) { statusEl.textContent = 'User ID tidak valid!'; statusEl.style.color = '#ef4444'; _lcSubmitting = false; return; }
        var dup = _lcRows.some(function(x) { return (x.kodeTiket||x.kode) === kc; });
        if (dup) { statusEl.textContent = 'Kode sudah ada!'; statusEl.style.color = '#ef4444'; _lcSubmitting = false; return; }
        var addedIds = [];
        function makeRow(id, kode) {
          return { id: id, user: parsed.user, kodeTiket: kode, hasTS: parsed.hasTS, autoStatus: '', autoCol9: '', autoCol10: '', manualStatus: '', betting: '', payout: '', totalFreeSpin: '', transactionId: '', profit: '', balance: '', spinType: '', symbols: [], payoutDetail: [], freeSpinDetail: [], secureStatus: '', createdAt: Date.now(), updatedAt: Date.now() };
        }
        var newId = _lcNextId++;
        _lcRows.push(makeRow(newId, kc));
        addedIds.push(newId);
        if (k2c) {
          var dup2 = _lcRows.some(function(x) { return (x.kodeTiket||x.kode) === k2c; });
          if (dup2) { statusEl.textContent = 'Kode 2 sudah ada!'; statusEl.style.color = '#ef4444'; _lcSubmitting = false; return; }
          var newId2 = _lcNextId++;
          _lcRows.push(makeRow(newId2, k2c));
          addedIds.push(newId2);
        }
        chrome.storage.local.set({ rows: _lcRows, nextRowId: _lcNextId }, function() {
          if (chrome.runtime.lastError) {
            statusEl.textContent = 'Gagal menyimpan!'; statusEl.style.color = '#ef4444'; _lcSubmitting = false; return;
          }
          /* INSTANT: proses langsung tanpa menunggu apa pun — kosongkan field,
             kirim TRIGGER_MANUAL, dan proses ulang data baru yang masuk selama
             submit. Verifikasi tulis dijalankan NON-BLOCKING di belakang. */
          statusEl.textContent = 'Data tersimpan — memproses...';
          statusEl.style.color = '#22c55e';
          /* Kosongkan HANYA field yang masih berisi nilai yang barusan disubmit.
             Jika user sudah mengetik/paste data baru selama proses async, field
             dibiarkan utuh lalu diproses ulang — tidak ada data yang terskip. */
          var curU = userInput.value.trim(), curK = kodeInput.value.trim(), curK2 = kode2Input.value.trim();
          if (curU === snapU) _setLcInput(userInput, '');
          if (curK === snapK) _setLcInput(kodeInput, '');
          if (curK2 === snapK2) _setLcInput(kode2Input, '');
          /* Reset dual mode hanya jika KEDUA kode (kode & kode2) sudah ter-submit;
             jika user masih mengetik data baru (field berubah), jangan reset. */
          if (curK === snapK && curK2 === snapK2) {
            _lcDualMode = false; btn2x.classList.remove('active'); btn2x.style.background = 'rgba(99,102,241,0.15)'; btn2x.style.color = '#818cf8'; kode2Wrap.style.display = 'none';
          }
          /* Overlay pick terkait kode yang baru disubmit → ikut direset. */
          if (curK === snapK) _lcOverlayPick = '';
          try { chrome.runtime.sendMessage({ type: "TRIGGER_MANUAL", priorityIds: addedIds }); } catch(e) {}
          /* Auto-check history (bonussmb.com/history) berjalan via countdown 60 detik, tidak langsung. */
          setTimeout(function() { statusEl.textContent = ''; }, 2000);
          _lcSubmitting = false;
          /* Data baru yang masuk selama submit → proses ulang agar tidak terskip */
          if (userInput.value.trim() && kodeInput.value.trim()) {
            try { tryLcAdd(); } catch(e) {}
          }
          /* Verifikasi NON-BLOCKING: baris yang barusan disubmit bisa tertimpa tulis
             konteks lain (background/popup/dashboard) yang mendarat setelah SET kita
             → baris "hilang" padahal field sudah dikosongkan. Cek di belakang; jika
             hilang, gabungkan ulang ke state terkini & tulis ulang (retry terbatas),
             lalu trigger manual ulang untuk baris yang diperbaiki. Tidak menunda
             proses — hanya pengaman agar tidak ada data yang terskip. */
          var checkKodes = k2c ? [kc, k2c] : [kc];
          var checkAttempt = 0;
          var repairRows = _lcRows.slice(); /* snapshot agar tidak tertimpa submit berikutnya */
          (function verifySaved() {
            chrome.storage.local.get(['rows', 'nextRowId'], function(r2) {
              var saved = r2.rows || [];
              var missing = checkKodes.filter(function(k) {
                return !saved.some(function(x) { return (x.kodeTiket || x.kode) === k; });
              });
              if (!missing.length) return;
              checkAttempt++;
              if (checkAttempt > 4) {
                /* Jangan hilang diam-diam — kasus ini persis bug "terhapus tapi tidak
                   tersimpan", jadi beri peringatan yang terlihat di panel. */
                console.warn('livechat-ocr: baris tertimpa tulis lain, perbaikan gagal', checkKodes);
                statusEl.textContent = '\u26A0 Data mungkin tertimpa tulis lain \u2014 cek panel data';
                statusEl.style.color = '#fcd34d';
                setTimeout(function() { if (statusEl.textContent.indexOf('\u26A0') === 0) statusEl.textContent = ''; }, 6000);
                return;
              }
              var merged = saved.slice();
              var reAdded = [];
              for (var mi = 0; mi < repairRows.length; mi++) {
                var mr = repairRows[mi];
                if (missing.indexOf(mr.kodeTiket || mr.kode) >= 0 && !merged.some(function(x) { return (x.kodeTiket || x.kode) === (mr.kodeTiket || mr.kode); })) {
                  merged.push(mr);
                  if (reAdded.indexOf(mr.id) < 0) reAdded.push(mr.id);
                }
              }
              chrome.storage.local.set({ rows: merged, nextRowId: Math.max(r2.nextRowId || 1, _lcNextId) }, function() {
                if (chrome.runtime.lastError) return;
                if (reAdded.length) {
                  try { chrome.runtime.sendMessage({ type: "TRIGGER_MANUAL", priorityIds: reAdded }); } catch(e) {}
                }
                verifySaved();
              });
            });
          })();
        });
      }); } catch(e) { _lcSubmitting = false; }
    }
    userInput.addEventListener('input', tryLcAdd);
    kodeInput.addEventListener('input', tryLcAdd);
    kode2Input.addEventListener('input', tryLcAdd);
    kodeInput.addEventListener('input', function() {
      if (!_lcSubmitting && !_lcRestoring && !kodeInput.value.trim() && _lcOverlayPick) _lcOverlayPick = '';
    });
  }

  function refreshPanel() {
    var panel = document.getElementById('lc-panel');
    if (!panel) { initPanel(); return; }

    var pt = document.getElementById('lc-pass-toggle');
    var saved = {
      user: document.getElementById('lc-user') ? document.getElementById('lc-user').value : '',
      kode: document.getElementById('lc-kode') ? document.getElementById('lc-kode').value : '',
      kode2: document.getElementById('lc-kode-2') ? document.getElementById('lc-kode-2').value : '',
      dualMode: _lcDualMode,
      overlayPick: _lcOverlayPick,
      genUser: document.getElementById('lc-gen-user') ? document.getElementById('lc-gen-user').value : '',
      passOpen: pt && pt.textContent.indexOf('▲') >= 0
    };

    panel.remove();
    initPanel();

    _lcRestoring = true;
    var nu = document.getElementById('lc-user');
    var nk = document.getElementById('lc-kode');
    if (nu && saved.user) { nu.value = saved.user; nu.dispatchEvent(new Event('input', { bubbles: true })); }
    if (nk && saved.kode) { nk.value = saved.kode; nk.dispatchEvent(new Event('input', { bubbles: true })); }
    if (saved.dualMode || saved.kode2) {
      var btn = document.getElementById('lc-btn-2x');
      if (btn && !_lcDualMode) btn.click();
      if (saved.kode2) {
        var nk2 = document.getElementById('lc-kode-2');
        if (nk2) { nk2.value = saved.kode2; nk2.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    }
    if (saved.genUser) {
      var ng = document.getElementById('lc-gen-user');
      if (ng) { ng.value = saved.genUser; ng.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    if (saved.passOpen) {
      var nt = document.getElementById('lc-pass-toggle');
      if (nt && nt.textContent.indexOf('▲') < 0) nt.click();
    }
    _lcOverlayPick = saved.overlayPick;
    _lcRestoring = false;
    /* Data yang dipulihkan tidak tersubmit otomatis (input dicegat _lcRestoring)
       → trigger sekali lagi agar tidak ada data yang terskip. */
    try { if (_lcTryAdd) _lcTryAdd(); } catch(e) {}
  }

  function checkPanelHealth() {
    if (!_ocrEnabled) return;
    var panel = document.getElementById('lc-panel');
    if (!panel) { initPanel(); return; }
    var btn = document.getElementById('lc-btn-2x');
    var kode2 = document.getElementById('lc-kode-2');
    var user = document.getElementById('lc-user');
    var kode = document.getElementById('lc-kode');
    if (!btn || !kode2 || !user || !kode || !panel.isConnected) { refreshPanel(); }
  }

  var _lcRows = null, _lcNextId = 1;

  function _lcLoadCache(cb) {
    if (_lcRows) { if (cb) cb(); return; }
    try { chrome.storage.local.get(['rows','nextRowId'], function(r) {
      _lcRows = r.rows || [];
      _lcNextId = r.nextRowId || 1;
      if (cb) cb();
    }); } catch(e) { if (cb) cb(); }
  }

  var _ocrEnabled = false;

  function setOcrState(enabled) {
    _ocrEnabled = enabled;
    var panel = document.getElementById('lc-panel');
    if (_ocrEnabled) {
      scanForImages();
      initPanel();
      if (panel) {
        panel.style.display = '';
        panel.style.right = '0';
        panel.dataset.hidden = 'false';
        var btn = document.getElementById('lc-toggle-btn');
        if (btn) btn.textContent = '\u25C0';
      }
    } else {
      if (panel) panel.style.display = 'none';
    }
  }

  function init() {
    if (!document.body) return requestAnimationFrame(init);

    try { chrome.storage.local.get('liveChatOcr', function(r) {
      setOcrState(r.liveChatOcr !== false);
      /* Pre-warm hanya kalau OCR aktif — jangan boros jika dimatikan user */
      if (_ocrEnabled) warmOcrIframe();
    }); } catch(e) { warmOcrIframe(); }

    var scanTimer;
    var lastScanImgCount = 0;
    var obs = new MutationObserver(function(mutations) {
      if (!_ocrEnabled) return;
      var hasNewImg = false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'childList' && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1) {
              if (n.tagName === 'IMG' || n.querySelector && n.querySelector('img')) { hasNewImg = true; break; }
            }
          }
        }
        if (m.type === 'attributes' && m.attributeName === 'src' && m.target.tagName === 'IMG') { hasNewImg = true; }
        if (hasNewImg) break;
      }
      if (!hasNewImg) return;
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scanForImages, 1000);
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class'] });

    setInterval(checkPanelHealth, 15000);

    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area !== 'local') return;
      if ('liveChatOcr' in changes) {
        setOcrState(changes.liveChatOcr.newValue !== false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
