import { $ } from './shared.js';

export function initPrediksi() {
  var pasaranSelect = $('#prediksiPasaran');
  if (!pasaranSelect) return;
  var generateBtn = $('#generatePrediksiBtn');
  var welcome = $('#prediksiWelcome');
  var results = $('#prediksiResults');
  var imgContainer = $('#prediksiImageContainer');
  var tableWrapper = $('#prediksiTableWrapper');

  var shios = ["Tikus","Kerbau","Macan","Kelinci","Naga","Ular","Kuda","Kambing","Monyet","Ayam","Anjing","Babi"];

  var prediksiImages = {
    "HOKI DRAW":"https://hokidraw.com/assets/img/logo.png","BANGKOK 0130":"https://bangkokpoolstoday.com/assets/img/bangkokpools_logo.png","BANGKOK 0930":"https://bangkokpoolstoday.com/assets/img/bangkokpools_logo.png","BRUNEI 02":"https://bruneipools.com/assets/img/brunei-logo.png","BRUNEI 14":"https://bruneipools.com/assets/img/brunei-logo.png","BRUNEI 21":"https://bruneipools.com/assets/img/brunei-logo.png","BULLSEYE":"https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/f07d4e2a6517ef1cea9e2a897e4abb98/nz-bullseye.png","CALIFORNIA":"https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/7c3b7b0affd7880d2dddf918ba2ac258/calottlogo.png","CAROLINADAY":"https://nclottery.com/Site/GFX/NCEL_Alt.svg","CAROLINAEVE":"https://nclottery.com/Site/GFX/NCEL_Alt.svg","CHELSEA 11":"https://chelseapools.co.uk/assets/img/chelseaPools_logo.png","CHELSEA 15":"https://chelseapools.co.uk/assets/img/chelseaPools_logo.png","CHELSEA 19":"https://chelseapools.co.uk/assets/img/chelseaPools_logo.png","CHELSEA 21":"https://chelseapools.co.uk/assets/img/chelseaPools_logo.png","FLORIDAEVE":"https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/a3e564ccb04c2b751ad4fa88c06e39c1/1-removebg-preview.png","FLORIDAMID":"https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/a3e564ccb04c2b751ad4fa88c06e39c1/1-removebg-preview.png","HONGKONG LOTTO":"https://cdn.areabermain.club/assets/cdn/az1/2025/09/07/20250907/7d2086796fd3d3af9aaed27d19fd9170/hongkong-lotto-1.png","HUAHIN 0100":"https://huahinlottery.com/assets/img/logo.png","HUAHIN 1630":"https://huahinlottery.com/assets/img/logo.png","HUAHIN 2100":"https://huahinlottery.com/assets/img/logo.png","KENTUCKYEVE":"https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/a5fafa0102d98ab3959ceb9bb1045729/kl-logo.png","KENTUCKYMID":"https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/a5fafa0102d98ab3959ceb9bb1045729/kl-logo.png","KING KONG4D SORE":"https://cdn.areabermain.club/assets/cdn/az9/2024/11/26/20241126/d1f18e378e4a422b41ffe8d03065ce7d/logo-7.png","KING KONG4D MALAM":"https://cdn.areabermain.club/assets/cdn/az9/2024/11/26/20241126/d1f18e378e4a422b41ffe8d03065ce7d/logo-7.png","MAGNUM4D":"https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/8889f1c5fc738b5148145100c08a0ebc/439-4390693-magnum-pengeluaran-magnum-4d-hari-clipart-removebg-preview.png","NEVADA":"https://www.nevadalottery.us/images/src/components/PageHead/images/logo.gif","NEWYORKEVE":"https://edit.nylottery.ny.gov/sites/default/files/logo-2179655b4229a219a9305b3f0e734bd0.png","NEWYORKMID":"https://edit.nylottery.ny.gov/sites/default/files/logo-2179655b4229a219a9305b3f0e734bd0.png","OREGON03":"https://cdn.areabermain.club/assets/cdn/az5/2026/03/21/20260321/fde7f514923557fa0d40d04d77afb119/download.png","OREGON06":"https://cdn.areabermain.club/assets/cdn/az5/2026/03/21/20260321/fde7f514923557fa0d40d04d77afb119/download.png","OREGON09":"https://cdn.areabermain.club/assets/cdn/az5/2026/03/21/20260321/fde7f514923557fa0d40d04d77afb119/download.png","OREGON12":"https://cdn.areabermain.club/assets/cdn/az5/2026/03/21/20260321/fde7f514923557fa0d40d04d77afb119/download.png","PCSO":"https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/32b1d9cb48d2c0a9f1c7e77853565fa1/pcso.png","POIPET12":"https://poipetlottery.com/img/logo.png","POIPET15":"https://poipetlottery.com/img/logo.png","POIPET19":"https://poipetlottery.com/img/logo.png","POIPET22":"https://poipetlottery.com/img/logo.png","SINGAPORE":"https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/07da64b7b63e905cf7e3adde14e57424/sgp.png","SYDNEY LOTTO":"https://sydneylotto.direct/assets/image/logo_sydney.png","TOTOCAMBODIA":"https://totocambodialive.com/assets/img/logo.png","TOTOMALI1530":"https://totomali.com/assets/img/logo.svg","TOTOMALI2030":"https://totomali.com/assets/img/logo.svg","TOTOMALI2330":"https://totomali.com/assets/img/logo.svg","TOTOMACAU PAGI":"https://cdn.areabermain.club/assets/cdn/az1/2025/09/07/20250907/dc9e0cea8a5e80da56d0b803d30586fe/totomacau-12-photoroom-photoroom.png","TOTOMACAU SIANG":"https://cdn.areabermain.club/assets/cdn/az1/2025/09/07/20250907/dc9e0cea8a5e80da56d0b803d30586fe/totomacau-12-photoroom-photoroom.png","TOTOMACAU SORE":"https://cdn.areabermain.club/assets/cdn/az1/2025/09/07/20250907/dc9e0cea8a5e80da56d0b803d30586fe/totomacau-12-photoroom-photoroom.png","TOTOMACAU MALAM I":"https://cdn.areabermain.club/assets/cdn/az1/2025/09/07/20250907/dc9e0cea8a5e80da56d0b803d30586fe/totomacau-12-photoroom-photoroom.png","TOTOMACAU MALAM II":"https://cdn.areabermain.club/assets/cdn/az1/2025/09/07/20250907/dc9e0cea8a5e80da56d0b803d30586fe/totomacau-12-photoroom-photoroom.png","TOTOMACAU MALAM III":"https://cdn.areabermain.club/assets/cdn/az1/2025/09/07/20250907/dc9e0cea8a5e80da56d0b803d30586fe/totomacau-12-photoroom-photoroom.png"
  };

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function randShios(n) {
    var s = shios.slice().sort(function() { return 0.5 - Math.random(); });
    return s.slice(0, n);
  }

  function fmtDate(d) {
    var m = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
  }

  generateBtn.addEventListener('click', function() {
    var pasaran = pasaranSelect.value;
    if (!pasaran) { alert('Silakan pilih pasaran togel terlebih dahulu!'); return; }
    var dateStr = fmtDate(new Date());
    var imgSrc = prediksiImages[pasaran] || '';
    var bbfs = rand(1000000, 9999999);
    var ikut = rand(10000, 99999);
    var fourD = []; for (var i = 0; i < 5; i++) fourD.push(rand(1000, 9999));
    var threeD = []; for (var i = 0; i < 4; i++) threeD.push(rand(100, 999));
    var twoD = []; for (var i = 0; i < 10; i++) twoD.push(rand(10, 99));
    var cb = []; for (var i = 0; i < 2; i++) cb.push(rand(1, 9));
    var cm = []; for (var i = 0; i < 3; i++) cm.push(rand(10, 99));
    var tw = []; for (var i = 0; i < 2; i++) { var n = rand(1, 9); tw.push('' + n + n); }
    var sh = randShios(3);

    welcome.style.display = 'none';
    results.style.display = 'block';

    imgContainer.innerHTML = '';
    if (imgSrc) {
      var pImg = document.createElement('img');
      pImg.src = imgSrc;
      pImg.alt = pasaran;
      pImg.addEventListener('error', function() { this.style.display = 'none'; });
      imgContainer.appendChild(pImg);
    }

    tableWrapper.innerHTML = '<table class="prediksi-table">' +
      '<tr><th>Tanggal</th><td>' + dateStr + '</td></tr>' +
      '<tr><th>BBFS Kuat</th><td>' + bbfs + '</td></tr>' +
      '<tr><th>Angka Ikut</th><td>' + ikut + '</td></tr>' +
      '<tr><th>4D (BB)</th><td>' + fourD.join(' / ') + '</td></tr>' +
      '<tr><th>3D (BB)</th><td>' + threeD.join(' / ') + '</td></tr>' +
      '<tr><th>2D (BB)</th><td>' + twoD.join(' / ') + '</td></tr>' +
      '<tr><th>Colok Bebas</th><td>' + cb.join(' / ') + '</td></tr>' +
      '<tr><th>Colok Macau</th><td>' + cm.join(' / ') + '</td></tr>' +
      '<tr><th>Twin</th><td>' + tw.join(' / ') + '</td></tr>' +
      '<tr><th>SHIO</th><td>' + sh.join(' / ') + '</td></tr>' +
      '</table>';
  });

  // ==================== COPY AS IMAGE ====================

  var copyPrediksiBtn = $('#copyPrediksiBtn');
  var copyPrediksiText = $('#copyPrediksiText');
  if (!copyPrediksiBtn) return;

  // --- Button feedback ---
  function resetCopyBtn() {
    copyPrediksiText.textContent = 'Salin Gambar';
    copyPrediksiBtn.style.background = '';
  }

  function copySuccess() {
    copyPrediksiText.textContent = 'Berhasil Disalin!';
    copyPrediksiBtn.style.background = 'linear-gradient(135deg,#065f46,#047857)';
    setTimeout(resetCopyBtn, 2500);
  }

  // --- Canvas primitives ---
  function drawRoundedBg(ctx, w, h, r) {
    var grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#0b0f1a');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r); ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h); ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(99,102,241,0.2)';
    ctx.lineWidth = 1.5; ctx.stroke();
  }

  function drawLogo(ctx, logoImg, w, y) {
    var lw = Math.min(logoImg.naturalWidth, 140);
    var lh = Math.min(logoImg.naturalHeight, 36);
    var ratio = Math.min(lw / logoImg.naturalWidth, lh / logoImg.naturalHeight);
    lw = logoImg.naturalWidth * ratio;
    lh = logoImg.naturalHeight * ratio;
    ctx.drawImage(logoImg, (w - lw) / 2, y, lw, lh);
  }

  function drawTitle(ctx, text, w, y, h) {
    ctx.fillStyle = '#818cf8';
    ctx.font = 'bold 15px Comfortaa, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, y + h / 2);
  }

  function drawTableHeader(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(15,23,42,0.9)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#818cf8';
    ctx.font = 'bold 11px Comfortaa, Segoe UI, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('KETERANGAN', x + 12, y + h / 2);
    ctx.textAlign = 'right';
    ctx.fillText('HASIL', x + w - 12, y + h / 2);
  }

  function drawRow(ctx, x, y, w, h, label, value, hasBorder, isEven) {
    ctx.fillStyle = isEven ? 'rgba(15,23,42,0.4)' : 'rgba(19,24,38,0.4)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#a5b4fc';
    ctx.font = '600 12px Segoe UI, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 12, y + h / 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'right';
    ctx.fillText(value, x + w - 12, y + h / 2);
    if (hasBorder) {
      ctx.strokeStyle = 'rgba(99,102,241,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 12, y + h);
      ctx.lineTo(x + w - 12, y + h);
      ctx.stroke();
    }
  }

  function drawFooterLine(ctx, x, y, w) {
    ctx.strokeStyle = 'rgba(99,102,241,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  }

  // --- Output helpers ---
  function clipboardOrDownload(canvas, filename) {
    return new Promise(function(resolve) {
      canvas.toBlob(async function(blob) {
        if (!blob) { downloadFallback(canvas, filename); resolve(); return; }
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          resolve();
        } catch (e) {
          downloadFallback(canvas, filename);
          resolve();
        }
      });
    });
  }

  function downloadFallback(canvas, filename) {
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // --- Main capture ---
  async function capturePrediksi() {
    var pasaran = pasaranSelect.value;
    if (!pasaran) return;
    var area = $('#prediksiCaptureArea');
    if (!area) return;

    var rows = area.querySelectorAll('.prediksi-table tr');
    var imgEl = area.querySelector('.prediksi-image-container img');

    // Load logo
    var logoLoaded = false;
    var logoImg = null;
    if (imgEl && imgEl.src && imgEl.style.display !== 'none') {
      logoImg = new Image();
      logoImg.crossOrigin = 'anonymous';
      try {
        await new Promise(function(res, rej) { logoImg.onload = res; logoImg.onerror = rej; logoImg.src = imgEl.src; });
        logoLoaded = true;
      } catch (e) {}
    }

    // Layout
    var PAD = 20;
    var LOGO_H = logoLoaded ? 56 : 0;
    var LOGO_PAD = logoLoaded ? 12 : 0;
    var TITLE_H = 36;
    var HEADER_H = 32;
    var ROW_H = 30;
    var COL1_W = 150;
    var COL2_W = 270;
    var W = COL1_W + COL2_W + PAD * 2;
    var ROW_COUNT = rows.length;
    var H = PAD + LOGO_H + LOGO_PAD + TITLE_H + HEADER_H + ROW_COUNT * ROW_H + PAD + 2;

    var SCALE = 2;
    var canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    var ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);

    // 1. Background
    drawRoundedBg(ctx, W, H, 10);

    var y = PAD;

    // 2. Logo
    if (logoLoaded && logoImg) {
      drawLogo(ctx, logoImg, W, y);
      y += LOGO_H + LOGO_PAD;
    }

    // 3. Title
    drawTitle(ctx, 'Hasil Prediksi - ' + pasaran, W, y, TITLE_H);
    y += TITLE_H;

    // 4. Table header
    drawTableHeader(ctx, PAD, y, W - PAD * 2, HEADER_H);
    y += HEADER_H;

    // 5. Data rows
    var labels = ['Tanggal','BBFS Kuat','Angka Ikut','4D (BB)','3D (BB)','2D (BB)','Colok Bebas','Colok Macau','Twin','SHIO'];
    var values = [];
    rows.forEach(function(r) {
      var td = r.querySelector('td');
      if (td) values.push(td.textContent.trim());
    });

    for (var i = 0; i < labels.length && i < values.length; i++) {
      drawRow(ctx, PAD, y, W - PAD * 2, ROW_H, labels[i], values[i], i < labels.length - 1, i % 2 === 0);
      y += ROW_H;
    }

    // 6. Footer line
    drawFooterLine(ctx, PAD, y, W - PAD * 2);

    // 7. Output
    var filename = 'prediksi-' + pasaran.replace(/\s+/g, '-') + '.png';
    await clipboardOrDownload(canvas, filename);
    copySuccess();
  }

  copyPrediksiBtn.addEventListener('click', capturePrediksi);
}
