import { $ } from './shared.js';

export function initPanduan() {
  var sel = $('#panduanSelect');
  if (!sel) return;
  var display = $('#panduanDisplay');
  var container = $('#panduanContainer');
  var img = $('#panduanImage');
  var copyBtn = $('#copyPanduanBtn');
  var copyText = $('#copyBtnText');
  var modal = $('#panduanModal');
  var modalImg = $('#panduanModalImg');
  var closeBtn = $('#panduanClose');
  var zoomBtns = document.querySelectorAll('.zoom-panduan-btn');
  var scale = 1, minS = 0.5, maxS = 5, xOff = 0, yOff = 0;
  var isPanning = false, isZooming = false;
  var initDist = 0, initScale = 1, initX = 0, initY = 0;

  function createLoader() {
    var div = document.createElement('div');
    div.className = 'loading-panduan';
    var sp = document.createElement('div');
    sp.className = 'spinner';
    div.appendChild(sp);
    return div;
  }
  function resetCopy() {
    copyText.textContent = 'Salin Gambar';
    copyBtn.style.background = '';
  }
  function showCopySuccess() {
    copyText.textContent = 'Berhasil Disalin!';
    copyBtn.style.background = 'linear-gradient(135deg,#065f46,#047857)';
    setTimeout(resetCopy, 2500);
  }
  async function copyImage(url) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.write) throw new Error('nope');
      var r = await fetch(url);
      var b = await r.blob();
      await navigator.clipboard.write([new ClipboardItem({[b.type]: b})]);
      showCopySuccess();
    } catch(e) {
      var a = document.createElement('a');
      a.href = url; a.download = 'panduan-betting.png';
      document.body.appendChild(a); a.click(); a.remove();
      showCopySuccess();
    }
  }
  function applyTransform() {
    modalImg.style.transform = 'translate('+xOff+'px,'+yOff+'px) scale('+scale+')';
  }
  function doZoom(s) {
    scale = Math.max(minS, Math.min(maxS, s));
    applyTransform();
  }
  function getDist(t) {
    return Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY);
  }
  function closeModal() {
    modal.style.display = 'none';
    document.body.style.overflow = '';
    xOff = 0; yOff = 0; scale = 1;
  }
  function zoomIn() { doZoom(scale * 1.3); }
  function zoomOut() { doZoom(scale / 1.3); }
  function resetZoom() { xOff = 0; yOff = 0; doZoom(1); }

  sel.addEventListener('change', function() {
    if (!this.value) { display.style.display = 'none'; return; }
    display.style.display = 'block';
    resetCopy();
    var loader = createLoader();
    img.style.display = 'none';
    container.appendChild(loader);
    var nImg = new Image();
    nImg.onload = function() {
      var l = container.querySelector('.loading-panduan');
      if (l) l.remove();
      img.src = this.src;
      img.alt = sel.options[sel.selectedIndex].text;
      img.style.display = 'block';
    };
    nImg.onerror = function() {
      var l = container.querySelector('.loading-panduan');
      if (l) l.remove();
      img.style.display = 'block';
      img.src = '';
      alert('Gagal memuat gambar.');
    };
    nImg.src = this.value;
  });
  img.addEventListener('click', function() {
    if (!this.src) return;
    modal.style.display = 'block';
    modalImg.src = this.src;
    modalImg.alt = this.alt;
    scale = 1; xOff = 0; yOff = 0;
    modalImg.style.transform = 'translate(0,0) scale(1)';
    document.body.style.overflow = 'hidden';
  });
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.style.display === 'block') closeModal();
  });
  zoomBtns.forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var z = this.getAttribute('data-zoom');
      if (z === 'in') zoomIn();
      else if (z === 'out') zoomOut();
      else resetZoom();
    });
  });
  modalImg.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault(); isZooming = true; isPanning = false;
      initDist = getDist(e.touches); initScale = scale;
    } else if (e.touches.length === 1 && scale > 1) {
      e.preventDefault(); isPanning = true; isZooming = false;
      initX = e.touches[0].clientX - xOff;
      initY = e.touches[0].clientY - yOff;
    }
  }, { passive: false });
  modalImg.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2 && isZooming) {
      e.preventDefault();
      doZoom(initScale * (getDist(e.touches) / initDist));
    } else if (e.touches.length === 1 && isPanning && scale > 1) {
      e.preventDefault();
      var cx = e.touches[0].clientX - initX;
      var cy = e.touches[0].clientY - initY;
      var mx = (modalImg.offsetWidth * scale - modalImg.offsetWidth) / 2;
      var my = (modalImg.offsetHeight * scale - modalImg.offsetHeight) / 2;
      xOff = Math.max(-mx, Math.min(mx, cx));
      yOff = Math.max(-my, Math.min(my, cy));
      applyTransform();
    }
  }, { passive: false });
  modalImg.addEventListener('touchend', function() {
    isZooming = false; isPanning = false;
  }, { passive: false });
  modalImg.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  modalImg.addEventListener('wheel', function(e) {
    e.preventDefault();
    doZoom(scale * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });
  copyBtn.addEventListener('click', function() {
    if (img.src && img.style.display !== 'none') copyImage(img.src);
  });

  var bolaTabs = document.querySelectorAll('.bola-tab-item');
  var bolaPanels = document.querySelectorAll('.bola-panel');
  if (bolaTabs.length && bolaPanels.length) {
    bolaTabs.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tab = btn.getAttribute('data-tab');
        bolaTabs.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        bolaPanels.forEach(function(p) { p.style.display = p.getAttribute('data-panel') === tab ? 'block' : 'none'; });
      });
    });
  }
}
