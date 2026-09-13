/* =====================================================================
 * OCR FRAME → DASHBOARD BRIDGE
 *
 * OCR Frame sekarang hanya sebagai perantara:
 * - Menerima OCR_RUN dari LiveChat (postMessage)
 * - Mengirim URL gambar ke Dashboard via chrome.storage
 * - Dashboard memproses OCR dengan pipeline canggih
 * - Hasil dikirim balik ke LiveChat via postMessage
 * ===================================================================== */

/* ---- Crop UI (sama seperti sebelumnya) ---- */
var _cropListeners = null;
var _activeCropCancel = null; /* doCancel() dari crop yang sedang aktif — dipakai pesan OCR_CROP_CANCEL dari parent (ESC) */

function cleanupCrop() {
  _activeCropCancel = null;
  if (_cropListeners) {
    var cl = _cropListeners;
    cl.container.removeEventListener('mousedown', cl.onMouseDown);
    window.removeEventListener('mousemove', cl.onMouseMove);
    window.removeEventListener('mouseup', cl.onMouseUp);
    document.getElementById('crop-confirm').removeEventListener('click', cl.doCrop);
    document.getElementById('crop-nama').removeEventListener('click', cl.doCropNama);
    document.getElementById('crop-cancel').removeEventListener('click', cl.doCancel);
    document.getElementById('crop-zoom-in').removeEventListener('click', cl.doZoomIn);
    document.getElementById('crop-zoom-out').removeEventListener('click', cl.doZoomOut);
    if (cl.onWheel) cl.container.removeEventListener('wheel', cl.onWheel);
    if (cl.onKeyDown) window.removeEventListener('keydown', cl.onKeyDown);
    _cropListeners = null;
  }
}

function showCropUI(img, reqId, source, url) {
  var overlay = document.getElementById('crop-overlay');
  var container = document.getElementById('crop-container');
  var cropImg = document.getElementById('crop-image');
  var selection = document.getElementById('crop-selection');
  var sizeLabel = document.getElementById('crop-size-label');
  var zoomDisplay = document.getElementById('crop-zoom-display');
  var zoomLevel = 1;
  var minZoom = 0.2;
  var maxZoom = 5;
  var dragState = null;
  var resizeHandle = null;
  var sel = { x: 0, y: 0, w: 0, h: 0 };

  container.style.overflow = 'hidden';

  /* Tampilkan overlay LANGSUNG (backdrop + toolbar) sebelum gambar selesai
     didecode — kesan "instant". Gambar + selection mengisi sesaat setelahnya. */
  overlay.classList.add('show');

  cropImg.src = '';
  cropImg.onload = function() {
    var iw = cropImg.naturalWidth, ih = cropImg.naturalHeight;
    var fw = window.innerWidth - 40, fh = window.innerHeight - 90;
    zoomLevel = Math.min(fw / iw, fh / ih);
    if (zoomLevel > 1) zoomLevel = 1;
    if (zoomLevel < 0.25) zoomLevel = 0.25;
    if (zoomLevel < minZoom) zoomLevel = minZoom;

    function applyZoom() {
      cropImg.style.width = (iw * zoomLevel) + 'px';
      cropImg.style.height = (ih * zoomLevel) + 'px';
      zoomDisplay.textContent = Math.round(zoomLevel * 100) + '%';
      container.style.width = (iw * zoomLevel) + 'px';
      container.style.height = (ih * zoomLevel) + 'px';
      // Batasi container ke viewport agar scroll aktif saat zoom membesar gambar
      container.style.maxWidth = fw + 'px';
      container.style.maxHeight = fh + 'px';
      container.style.overflow = 'auto';
      updateSel();
    }

    function updateSel() {
      if (sel.w > 0 && sel.h > 0) {
        selection.style.left = (sel.x * zoomLevel) + 'px';
        selection.style.top = (sel.y * zoomLevel) + 'px';
        selection.style.width = (sel.w * zoomLevel) + 'px';
        selection.style.height = (sel.h * zoomLevel) + 'px';
        sizeLabel.textContent = sel.w + '\u00D7' + sel.h;
        selection.classList.add('show');
        updateGuides();
      } else {
        selection.classList.remove('show');
        var _gl = document.getElementById('crop-guide-l');
        var _gr = document.getElementById('crop-guide-r');
        var _gt = document.getElementById('crop-guide-t');
        var _gb = document.getElementById('crop-guide-b');
        if (_gl) _gl.style.display = 'none';
        if (_gr) _gr.style.display = 'none';
        if (_gt) _gt.style.display = 'none';
        if (_gb) _gb.style.display = 'none';
      }
      container.style.overflow = 'auto';
    }

    function updateGuides() {
      if (sel.w === 0) return;
      var gl = document.getElementById('crop-guide-l');
      var gr = document.getElementById('crop-guide-r');
      var gt = document.getElementById('crop-guide-t');
      var gb = document.getElementById('crop-guide-b');
      var sl = sel.x * zoomLevel, st = sel.y * zoomLevel;
      var sw2 = sel.w * zoomLevel, sh2 = sel.h * zoomLevel;
      gl.style.left = sl + 'px'; gl.style.display = 'block';
      gr.style.left = (sl + sw2) + 'px'; gr.style.display = 'block';
      gt.style.top = st + 'px'; gt.style.display = 'block';
      gb.style.top = (st + sh2) + 'px'; gb.style.display = 'block';
    }

    applyZoom();

    function getMousePos(e) {
      var cr = container.getBoundingClientRect();
      return { x: (e.clientX - cr.left + container.scrollLeft) / zoomLevel, y: (e.clientY - cr.top + container.scrollTop) / zoomLevel };
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      var pos = getMousePos(e);
      var t = e.target;
      if (t.classList.contains('handle')) {
        resizeHandle = t.classList.contains('tl') ? 'tl' : t.classList.contains('tr') ? 'tr' : t.classList.contains('bl') ? 'bl' : 'br';
        dragState = { sx: sel.x, sy: sel.y, sw: sel.w, sh: sel.h, mx: pos.x, my: pos.y };
        e.preventDefault();
        return;
      }
      if (t === selection || t.parentElement === selection) {
        dragState = { sx: sel.x, sy: sel.y, sw: sel.w, sh: sel.h, mx: pos.x, my: pos.y };
        e.preventDefault();
        return;
      }
      sel.x = pos.x; sel.y = pos.y; sel.w = 0; sel.h = 0;
      dragState = { sx: pos.x, sy: pos.y, sw: 0, sh: 0, mx: pos.x, my: pos.y, newSel: true };
      e.preventDefault();
    }

    function onMouseMove(e) {
      if (!dragState) return;
      var pos = getMousePos(e);
      var dx = pos.x - dragState.mx;
      var dy = pos.y - dragState.my;

      if (resizeHandle) {
        if (resizeHandle === 'tl') {
          sel.x = Math.max(0, dragState.sx + dx);
          sel.y = Math.max(0, dragState.sy + dy);
          sel.w = Math.max(20, dragState.sw - (sel.x - dragState.sx));
          sel.h = Math.max(20, dragState.sh - (sel.y - dragState.sy));
        } else if (resizeHandle === 'tr') {
          sel.y = Math.max(0, dragState.sy + dy);
          sel.w = Math.max(20, dragState.sw + dx);
          sel.h = Math.max(20, dragState.sh - (sel.y - dragState.sy));
        } else if (resizeHandle === 'bl') {
          sel.x = Math.max(0, dragState.sx + dx);
          sel.w = Math.max(20, dragState.sw - (sel.x - dragState.sx));
          sel.h = Math.max(20, dragState.sh + dy);
        } else if (resizeHandle === 'br') {
          sel.w = Math.max(20, dragState.sw + dx);
          sel.h = Math.max(20, dragState.sh + dy);
        }
        var iw2 = iw * zoomLevel, ih2 = ih * zoomLevel;
        if (sel.x + sel.w > iw) sel.w = iw - sel.x;
        if (sel.y + sel.h > ih) sel.h = ih - sel.y;
      } else if (dragState.newSel) {
        sel.x = Math.min(dragState.sx, pos.x);
        sel.y = Math.min(dragState.sy, pos.y);
        sel.w = Math.abs(dx);
        sel.h = Math.abs(dy);
      } else {
        sel.x = Math.max(0, Math.min(iw - sel.w, dragState.sx + dx));
        sel.y = Math.max(0, Math.min(ih - sel.h, dragState.sy + dy));
      }
      updateSel();
    }

    function onMouseUp() {
      dragState = null;
      resizeHandle = null;
    }

    function buildCropCanvas() {
      // Cap ukuran canvas crop (maks 2000px) — data URL tetap kecil & cepat diproses,
      // OCR tetap mendapat resolusi yang cukup (engine sendiri menargetkan ~1600-2200px).
      var cw = Math.round(sel.w), ch = Math.round(sel.h);
      var CAP = 2000;
      if (Math.max(cw, ch) > CAP) {
        var s = CAP / Math.max(cw, ch);
        cw = Math.round(cw * s); ch = Math.round(ch * s);
      }
      var cropCanvas = document.createElement('canvas');
      cropCanvas.width = cw;
      cropCanvas.height = ch;
      var cropCtx = cropCanvas.getContext('2d');
      cropCtx.imageSmoothingEnabled = true;
      cropCtx.imageSmoothingQuality = 'high';
      cropCtx.drawImage(cropImg, sel.x, sel.y, sel.w, sel.h, 0, 0, cw, ch);
      return cropCanvas;
    }

    function doCrop() {
      if (sel.w < 10 || sel.h < 10) return;
      cleanupCrop();
      overlay.classList.remove('show');
      // Konversi ke data URL dan kirim ke dashboard via bridge
      var dataUrl = buildCropCanvas().toDataURL('image/png');
      bridgeScanToDashboard(dataUrl, reqId, source, url, 'codes', true);
    }

    function doCropNama() {
      if (sel.w < 10 || sel.h < 10) return;
      cleanupCrop();
      overlay.classList.remove('show');
      // Konversi ke data URL dan kirim ke dashboard via bridge (mode all text)
      var dataUrl = buildCropCanvas().toDataURL('image/png');
      bridgeScanToDashboard(dataUrl, reqId, source, url, 'all', true);
    }

    function doCancel() {
      cleanupCrop();
      overlay.classList.remove('show');
      source.postMessage({
        type: 'OCR_RESULT',
        reqId: reqId,
        cancelled: true,
        url: url
      }, '*');
    }

    function doZoomIn() {
      zoomLevel = Math.min(maxZoom, zoomLevel * 1.25);
      applyZoom();
    }

    function doZoomOut() {
      zoomLevel = Math.max(minZoom, zoomLevel / 1.25);
      applyZoom();
    }

    /* ESC = BATAL (instruksi user): tutup crop tanpa memproses. */
    function onKeyDown(e) {
      if (e.key === 'Escape') doCancel();
    }

    function onWheel(e) {
      e.preventDefault();
      var rect = container.getBoundingClientRect();
      var cursorX = e.clientX - rect.left + container.scrollLeft;
      var cursorY = e.clientY - rect.top + container.scrollTop;
      var factor = e.deltaY < 0 ? 1.25 : 0.8;
      var newZoom = Math.max(minZoom, Math.min(maxZoom, zoomLevel * factor));
      var scale = newZoom / zoomLevel;
      zoomLevel = newZoom;
      applyZoom();
      container.scrollLeft = (cursorX * scale) - container.clientWidth / 2;
      container.scrollTop = (cursorY * scale) - container.clientHeight / 2;
    }

    cleanupCrop();
    _activeCropCancel = doCancel; /* parent (livechat) bisa batalkan crop via ESC → OCR_CROP_CANCEL */
    _cropListeners = {
      container: container, onMouseDown: onMouseDown, onMouseMove: onMouseMove, onMouseUp: onMouseUp,
      doCrop: doCrop, doCropNama: doCropNama, doCancel: doCancel, doZoomIn: doZoomIn, doZoomOut: doZoomOut,
      onWheel: onWheel, onKeyDown: onKeyDown
    };
    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    document.getElementById('crop-confirm').addEventListener('click', doCrop);
    document.getElementById('crop-nama').addEventListener('click', doCropNama);
    document.getElementById('crop-cancel').addEventListener('click', doCancel);
    document.getElementById('crop-zoom-in').addEventListener('click', doZoomIn);
    document.getElementById('crop-zoom-out').addEventListener('click', doZoomOut);
    container.addEventListener('wheel', onWheel, { passive: false });
  };
  /* Gambar data: URL (dari content script) sudah same-origin — tidak perlu
     round-trip canvas→toBlob. HTTP URL tetap lewat toBlob agar tidak double-
     fetch dan canvas tidak ter-taint. */
  if (url && url.indexOf('data:') === 0) {
    cropImg.src = url;
  } else {
    var convC = document.createElement('canvas');
    convC.width = img.naturalWidth; convC.height = img.naturalHeight;
    convC.getContext('2d').drawImage(img, 0, 0);
    convC.toBlob(function(blob) { cropImg.src = URL.createObjectURL(blob); });
  }
}

/* =====================================================================
 * BRIDGE: OCR Frame → Dashboard via chrome.storage
 * ===================================================================== */

/**
 * Kirim scan request ke Dashboard dan polling hasilnya.
 * @param {string} url - URL gambar atau data: URL dari crop
 * @param {string} reqId - Request ID dari LiveChat
 * @param {Window} source - Window asal (LiveChat) untuk kirim balik hasil
 * @param {string} originalUrl - URL asli gambar (untuk referensi)
 * @param {string} mode - 'codes' atau 'all'
 */
function bridgeScanToDashboard(url, reqId, source, originalUrl, mode, isCrop) {
  mode = mode || 'codes';
  var reqKey = '_ocrBridgeReq_' + reqId;
  var resKey = '_ocrBridgeRes_' + reqId;

  var settled = false;

  function relayResult(result) {
    result = result || {};
    if (mode === 'all') {
      // Mode NAMA/RRN
      source.postMessage({
        type: 'OCR_RESULT_ALL',
        reqId: reqId,
        text: result.text || '',
        allRaw: result.allRaw || '',
        lines: result.lines || [],
        elapsed: result.elapsed || '',
        error: result.error || '',
        url: originalUrl
      }, '*');
    } else {
      // Mode kode tiket
      source.postMessage({
        type: 'OCR_RESULT',
        reqId: reqId,
        codes: result.codes || [],
        codeInfo: result.codeInfo || {},
        bestCodes: result.bestCodes || [],
        lines: result.lines || [],
        varLines: result.varLines || [],
        varRawLines: result.varRawLines || [],
        var0Lines: result.var0Lines || [],
        passages: result.passages || [],
        elapsed: result.elapsed || '',
        allRaw: result.allRaw || '',
        isPartial: false,
        error: result.error || '',
        engineVersion: result.engineVersion || '',
        procInfo: result.procInfo || null,
        climbInfo: result.climbInfo || null,
        url: originalUrl
      }, '*');
    }
  }

  function finish(result) {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutTimer);
    clearInterval(pollTimer);
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch(e) {}
    chrome.storage.local.remove([reqKey, resKey]);
    relayResult(result);
  }

  // Event-driven: tanggapi langsung saat Dashboard menulis hasil (tanpa delay polling)
  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (!(resKey in changes)) return;
    finish(changes[resKey].newValue);
  }
  chrome.storage.onChanged.addListener(onStorageChanged);

  // Fallback polling (edge case bila onChanged tidak terpanggil)
  var pollTimer = setInterval(function() {
    chrome.storage.local.get(resKey, function(data) {
      var result = data[resKey];
      if (!result) return;
      finish(result);
    });
  }, 300);

  // Timeout setelah 180 detik (model best + canvas besar bisa lama; 120s dulu
  // bisa memutus scan potret HP 7.2MP yang diproses chunking + corner pass)
  var timeoutTimer = setTimeout(function() {
    if (settled) return;
    settled = true;
    clearInterval(pollTimer);
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch(e) {}
    chrome.storage.local.remove([reqKey, resKey]);
    source.postMessage({
      type: mode === 'all' ? 'OCR_RESULT_ALL' : 'OCR_RESULT',
      reqId: reqId,
      codes: [],
      text: '',
      error: 'Dashboard timeout',
      lines: [],
      url: originalUrl
    }, '*');
  }, 180000);

  // Payload kecil (URL http) → storage; payload besar (data URL crop) → runtime message
  // (storage.local lambat & punya batas 8MB/item — data URL PNG besar bisa gagal diam-diam)
  if (url.indexOf('data:') === 0) {
    // sendMessage return Promise — rejection terjadi async (tanpa receiver),
    // jadi tangani via .catch untuk fallback ke storage.
    // isCrop=true untuk hasil crop MANUAL (jangan di-crop ulang di engine);
    // screenshot FULL (bukan crop) dikirim dengan isCrop=false agar engine
    // menerapkan strip kiri 50% + MANUAL_CROPS.
    var p = chrome.runtime.sendMessage({ type: 'OCR_BRIDGE_REQ', reqId: reqId, url: url, mode: mode, originalUrl: originalUrl, isCrop: !!isCrop });
    if (p && typeof p.catch === 'function') {
      p.catch(function() {
        try { chrome.storage.local.set({ [reqKey]: { url: url, mode: mode, originalUrl: originalUrl, isCrop: !!isCrop, timestamp: Date.now() } }); } catch(e2) {}
      });
    }
  } else {
    chrome.storage.local.set({ [reqKey]: { url: url, mode: mode, originalUrl: originalUrl, isCrop: !!isCrop, timestamp: Date.now() } });
  }
}

/* ---- Message listener ---- */
window.addEventListener('message', function(e) {
  if (!e.data) return;

  if (e.data.type === 'PING') {
    try { e.source.postMessage({ type: 'PONG' }, '*'); } catch(e) {}
    return;
  }

  /* ESC = BATAL dari parent (livechat-ocr): fokus keyboard bisa berada di halaman
     induk, jadi parent yang menangkap ESC lalu meneruskannya ke sini. */
  if (e.data.type === 'OCR_CROP_CANCEL') {
    if (_activeCropCancel) { try { _activeCropCancel(); } catch(e) {} }
    return;
  }

  if (e.data.type !== 'OCR_RUN' || !e.data.url) return;

  if (e.data.cropMode) {
    // BERSIHKAN state crop LAMA dulu (gambar + seleksi + guides + listener) —
    // tanpa ini, bayangan crop sebelumnya masih terlihat sampai gambar baru
    // selesai dimuat (bug "bayangan crop lama tertinggal").
    cleanupCrop();
    var _oldImg = document.getElementById('crop-image');
    if (_oldImg) _oldImg.removeAttribute('src');
    var _oldSel = document.getElementById('crop-selection');
    if (_oldSel) _oldSel.classList.remove('show');
    var _oldGuides = ['crop-guide-l', 'crop-guide-r', 'crop-guide-t', 'crop-guide-b'];
    for (var _ogi = 0; _ogi < _oldGuides.length; _ogi++) {
      var _og = document.getElementById(_oldGuides[_ogi]);
      if (_og) _og.style.display = 'none';
    }
    // Mode crop: tampilkan SHELL UI (backdrop + toolbar + "Memuat gambar…")
    // INSTAN sebelum gambar selesai dimuat — kesan masuk crop langsung terasa.
    var _shellOv = document.getElementById('crop-overlay');
    var _shellLd = document.getElementById('crop-loading');
    if (_shellOv) _shellOv.classList.add('show');
    if (_shellLd) _shellLd.style.display = 'block';
    var tempImg = new Image();
    tempImg.crossOrigin = 'anonymous';
    tempImg.onload = function() {
      if (_shellLd) _shellLd.style.display = 'none';
      showCropUI(tempImg, e.data.reqId, e.source, e.data.url);
      try {
        parent.postMessage({
          type: 'OCR_CROP_START',
          reqId: e.data.reqId,
          imgW: tempImg.naturalWidth,
          imgH: tempImg.naturalHeight,
          url: e.data.url
        }, '*');
      } catch(e) {}
    };
    tempImg.onerror = function() {
      if (_shellOv) _shellOv.classList.remove('show');
      if (_shellLd) _shellLd.style.display = 'none';
      e.source.postMessage({
        type: 'OCR_RESULT', reqId: e.data.reqId,
        codes: [], error: 'Gagal memuat gambar untuk crop', lines: [], url: e.data.url
      }, '*');
    };
    tempImg.src = e.data.url;
  } else {
    // Mode normal: screenshot FULL (bukan crop) — isCrop=false agar engine
    // menerapkan strip kiri 50% + MANUAL_CROPS untuk semua resolusi.
    bridgeScanToDashboard(e.data.url, e.data.reqId, e.source, e.data.url, 'codes', false);
  }
});

parent.postMessage({ type: 'OCR_IFRAME_READY' }, '*');
