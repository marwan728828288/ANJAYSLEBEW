/* =====================================================================
 * OCR COMMON HELPERS — disesuaikan dengan ocr-frame.js
 *
 * Fungsi-fungsi ini identik dengan yang ada di ocr-frame.js.
 * Digunakan oleh dashboard.js dan popup.js agar tidak duplikat.
 * ===================================================================== */

/* ---- Ekstrak angka dari string ---- */
export function getTokens(str) {
  if (!str) return [];
  return str.match(/\d+/g) || [];
}

/* ---- Validasi kode tiket 19 digit mulai '2' (format 9+10) ---- */
export function validCode(code) {
  if (!code || code.length !== 19) return false;
  if (code[0] !== '2') return false;
  if (/^(\d)\1+$/.test(code)) return false;
  if (/(\d)\1{10,}/.test(code)) return false;
  return true;
}

/* ---- Ekstrak kode tiket format 9+10 (9 digit + 10 digit = 19 digit) dari teks OCR ---- */
export function extractCodes(text) {
  var lines = text.split('\n').filter(Boolean);
  var seen = {};
  var result = [];

  function add(code) {
    if (!code || seen[code]) return;
    if (!validCode(code)) return;
    seen[code] = true;
    result.push(code);
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var toks = getTokens(line);
    if (toks.length > 12) continue;

    // 1. Token 19 digit utuh (kode terbaca tanpa spasi)
    for (var t = 0; t < toks.length; t++) {
      if (toks[t].length === 19) add(toks[t]);
    }

    // 2. Satu baris: gabungkan DUA digit-run yang BERDEKATAN & totalnya 19 digit —
    //    Tesseract sering memecah kode jadi potongan (9+10, 5+14 dipisah '+', 10+9,
    //    atau spasi antar grup). Token KIRI harus mulai '2' DAN panjang ≥ 5 (format
    //    kode tiket; potongan nyata minimal 5 digit seperti "29965"). Adjacency +
    //    guard ≥ 5 mencegah false positive (mis. tahun "2025" + angka 15 digit,
    //    atau "2" + angka 18 digit — keduanya bukan kode).
    for (var a = 0; a < toks.length; a++) {
      if (toks[a].length < 5 || toks[a].length >= 19 || toks[a][0] !== '2') continue;
      var nb = a + 1;
      if (nb < toks.length && toks[a].length + toks[nb].length === 19) add(toks[a] + toks[nb]);
    }

    // 3. Lintas baris (gap ≤ 2, baris tengah tanpa digit-run ≥ 9): kode 9 digit
    //    (mulai '2') di baris ini + 10 digit di baris berikutnya = 19 (wrap OCR).
    for (var a = 0; a < toks.length; a++) {
      if (toks[a].length === 9 && toks[a][0] === '2') {
        for (var gap = 1; gap <= 2 && i + gap < lines.length; gap++) {
          var canBridge = true;
          for (var m = 1; m < gap; m++) {
            var midToks = getTokens(lines[i + m]);
            for (var mt = 0; mt < midToks.length; mt++) {
              if (midToks[mt].length >= 9) { canBridge = false; break; }
            }
            if (!canBridge) break;
          }
          if (!canBridge) break;
          var nextToks = getTokens(lines[i + gap]);
          for (var b = 0; b < nextToks.length; b++) {
            if (nextToks[b].length === 10) add(toks[a] + nextToks[b]);
          }
        }
      }
    }

  }

  return result;
}

/* ---- Baris pemisah hasil gabungan multi-pass (mis. "── dil ps6 ──") ----
   Pemisah adalah TEMBOK: pencarian kode TIDAK boleh menembusnya.
   Tanpa ini, baris + dari pass 2 bisa mengambil kode dari pass 1 (false best).
   Dukung karakter U+2500 (─) maupun ASCII (-/=) karena Tesseract bisa output keduanya. */
export function isSeparatorLine(line) {
  if (!line) return false;
  // Label boleh mengandung spasi (mis. "── dil ps6 ──"): [A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*
  return /[-─=]{2,}\s*[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*\s*[-─=]{2,}/.test(line);
}

/* Pecah baris gabungan multi-pass menjadi blok per-pass (pemisah dijadikan batas).
   Setiap blok diproses terpisah → baris + dari satu pass TIDAK bisa mengambil
   kode dari pass lain. Mengembalikan array of arrays. */
export function splitPassBlocks(lines) {
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

/* ---- tryBestSplit: cari kode di baris terdekat dengan posisi + ---- */
export function tryBestSplit(foundCodes, lines, lineIdx) {
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

/* ---- getAllBestCodes: deteksi kode yang terkait dengan nilai taruhan (+) ----
   Baris pemisah multi-pass (── … ──) memecah input jadi BLOK per pass;
   setiap blok diproses terpisah sehingga + dari pass 2 tidak bisa mengambil
   kode dari pass 1 (bug "29965+ ngambil kode 208328747"). */
export function getAllBestCodes(lines, foundCodes, relaxed) {
  var results = [];
  function addCode(r) {
    if (r && results.indexOf(r) === -1) results.push(r);
  }

  function processBlock(block) {
    // Normalisasi: hilangkan spasi di sekitar + agar baris "10000 + 500000" tetap terbaca
    for (var ni = 0; ni < block.length; ni++) {
      block[ni] = block[ni].replace(/ ?\+ ?/g, '+');
    }
    for (var i = 0; i < block.length; i++) {
      if (block[i].indexOf('+') >= 0 && !block[i].match(/^\d{2}:\d{2}/)) {
        var idx = block[i].indexOf('+');
        // ocr-frame.js: skip if surrounded by spaces (AND condition)
        if (idx > 0 && block[i][idx - 1] === ' ' && idx < block[i].length - 1 && block[i][idx + 1] === ' ') continue;
        /* Guard noise '+': digit-run PERSIS sebelum '+' (diizinkan spasi sisa
           normalisasi, mis. "10000  +" → "10000 +") harus ada — pola nilai
           taruhan "10000+" / "10000+500000". '+', palsu dari noise
           (border/ikon/spek) yang menempel di awal baris atau di huruf ditolak
           — mencegah kode yang salah disorot sebagai best. */
        if (idx <= 0 || !/\d\s*$/.test(block[i].substring(0, idx))) continue;
        var before = block[i].substring(0, idx).match(/\d+/g);
        var after = block[i].substring(idx + 1).match(/\d+/g);
        var strict = before && before.length && after && after.length;
        var loose = (before && before.length) || (after && after.length);
        if (idx > 0 && (strict || (relaxed && loose))) {
          addCode(tryBestSplit(foundCodes, block, i));
        }
      }
    }
  }

  var blocks = splitPassBlocks(lines);
  for (var bi = 0; bi < blocks.length; bi++) processBlock(blocks[bi]);
  return results;
}

/* ---- Sharpen: pertegas tepi karakter (bantu deteksi + yang tipis) ---- */
// Optimasi: hanya proses channel R (setelah grayscale, R=G=B)
// Hemat 75% memory copy + iterasi lebih sedikit
export function sharpen(imageData) {
  var d = imageData.data;
  var w = imageData.width;
  var h = imageData.height;
  var len = w * h;
  // Hanya copy channel R — 1 byte/pixel vs 4 byte/pixel (hemat 75%)
  var gray = new Uint8Array(len);
  for (var i = 0; i < len; i++) gray[i] = d[i * 4];
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var gi = y * w + x;
      var v = (-gray[gi - w] - gray[gi - 1] - gray[gi + 1] - gray[gi + w] + 5 * gray[gi]);
      var di = gi * 4;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[di] = d[di+1] = d[di+2] = v;
    }
  }
}

/* ---- Invert — teks putih di latar gelap jadi hitam (resep per-tahap aturan) ---- */
export function invert(imageData) {
  var u32 = new Uint32Array(imageData.data.buffer);
  var len = u32.length;
  for (var i = 0; i < len; i++) {
    u32[i] ^= 0x00FFFFFF;
  }
}

/* ---- Adaptive contrast enhancement (histogram clip) ---- */
// Optimasi: early-exit jika range histogram sudah >= 200 (kontras sudah bagus)
// Skip scaling pass untuk gambar high-contrast → hemat 1 pass pixel
export function enhanceContrast(imageData, clipPercent) {
  if (clipPercent === undefined) clipPercent = 0.02;
  var d = imageData.data;
  var len = d.length;
  var n = len / 4;

  for (var i = 0; i < len; i += 4) {
    var g = (0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]) | 0;
    d[i] = d[i+1] = d[i+2] = g;
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

  // Early-exit: jika range sudah >= 200 (dari 255), kontras sudah optimal
  // Skip scaling pass — hemat O(n) pixel processing
  if (range >= 200) return;

  var scale = 255 / range;
  for (var i = 0; i < len; i += 4) {
    var v = (d[i] - minVal) * scale;
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    d[i] = d[i+1] = d[i+2] = Math.round(v);
  }
}

/* ---- Grayscale dilation: tebalkan fitur tipis (simbol +) agar mudah dideteksi Tesseract ---- */
export function dilateGray(imageData, radius) {
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
          var val = copy[((y+dy) * w + (x+dx)) * 4];
          if (val < minVal) minVal = val;
        }
      }
      var i = (y * w + x) * 4;
      d[i] = d[i+1] = d[i+2] = minVal;
    }
  }
}

/* ---- Dilasi adaptif: radius 1 & skip jika kontras sudah bagus ---- */
// radius 1 (3×3) lebih ringan dari radius 2 (5×5) — cukup untuk simbol +,
// dan di-skip total untuk gambar yang kontrasnya sudah bagus (range >= 200).
export function adaptiveDilate(imageData, srcW, srcH) {
  if (Math.max(srcW, srcH) <= 1400) return; // gambar kecil: teks sudah besar, tanpa dilasi
  var d = imageData.data;
  var len = d.length;
  var minV = 255, maxV = 0;
  for (var i = 0; i < len; i += 4) {
    var v = d[i];
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (maxV - minV >= 200) return; // kontras sudah bagus → skip dilasi (hemat waktu)
  dilateGray(imageData, 1);
}

/* ---- Penghapus noise spek (salt-and-pepper) ----
   Spek kecil (1-3px: artefak JPEG, antialiasing, debu UI) menyebabkan dua masalah:
   1) simbol + ASLI terbaca 4 — spek mengisi sudut silang + sehingga LSTM melihat
      diagonal seperti angka 4; dan
   2) + PALSU di tempat lain — spek berbentuk silang dipaksa jadi '+' oleh whitelist
      '0123456789+' (Tesseract tidak punya opsi "reject").
   Solusi: buang komponen gelap ber-area <= maxArea SEBELUM dilasi. Aman untuk
   glyph asli — area komponen huruf/digit/+ (puluhan px) jauh lebih besar dari spek. */
export function removeSpecks(imageData, maxArea) {
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
        /* Hanya kumpulkan pixel jika area masih dalam ambang — komponen besar
           (glyph/teks/panel) tidak perlu disimpan (hemat memori). */
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

/* =====================================================================
 * SHARED SCALE CALCULATION — SATU-SATUNYA sumber logika scale.
 *
 * Fungsi ini digunakan oleh dashboard.js dan popup.js via import.
 * ocr-frame.js (classic script) mendefinisikan fungsi identik secara lokal
 * dengan komentar merujuk ke sini.
 *
 * SELALU update fungsi ini dulu, baru update salinan di ocr-frame.js!
 * ===================================================================== */

/**
 * Hitung scale optimal untuk preprocessing OCR.
 * @param {number} w - Lebar gambar asli
 * @param {number} h - Tinggi gambar asli
 * @returns {{ scale: number, dpi: number, isIOSLike: boolean }}
 */
export function calculateOptimalScale(w, h) {
  var maxDim = Math.max(w, h);
  var minDim = Math.min(w, h);
  var aspectRatio = maxDim / minDim;
  var isLandscape = w > h;

  // Deteksi iOS screenshot: portrait, resolusi tinggi, aspect ratio > 1.4
  var isIOSLike = (h > w && aspectRatio > 1.4 && maxDim > 1500) ||
                  (w > h && aspectRatio > 1.4 && maxDim > 1500);

  // Scale adaptif
  var targetSize = isIOSLike ? 1600 : 1400;
  var maxScale = 4.0;
  var scale = Math.min(targetSize / maxDim, maxScale);

  // Landscape desktop screenshots (e.g. 1920×1080): teks biasanya kecil, butuh scale lebih tinggi
  if (isLandscape && maxDim >= 1900 && minDim >= 1000) {
    scale = Math.max(scale, 2.0);
  }
  // Minimum scale: hanya untuk gambar yang LEBIH KECIL dari target (scale > 1.0)
  // Gambar besar (scale < 1.0) pakai raw scale — jangan upscale!
  else if (scale < 1.0) {
    if (maxDim > 3000 && scale < 1.5) {
      scale = 1.5;
    } else if (maxDim > 2200) {
      // 1080×2400, 1440×2560 dll: butuh scale 1.5 agar simbol + terdeteksi
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

  // OCR cepat: batasi upscale untuk gambar besar, namun tetap cukup besar
  // agar teks di area tepi (mis. kiri-atas 720×1604 & 720×1920) masih terbaca.
  // Cap SERAGAM 1.5× untuk gambar >1400px. Dulu ada cap 1.2× untuk >2200px yang
  // menekan potret HP (1206×2622 / 1208×2644) padahal komentar kode sendiri
  // bilang butuh scale 1.5× agar simbol + terdeteksi.
  if (maxDim > 1400 && scale > 1.5) scale = 1.5;

  // Pixel cap: batasi upscale untuk gambar besar agar OCR satu-pass tidak membengkak
  var maxPixels = 5000000;
  var pixelCap = Math.sqrt(maxPixels / (w * h));
  if (scale > pixelCap) scale = pixelCap;

  return {
    scale: scale,
    dpi: Math.round(96 * scale),
    isIOSLike: isIOSLike
  };
}

/* =====================================================================
 * CHUNKING POTRET TINGGI — helper BERSAMA (ocr-engine / ocr-bridge / popup)
 * ===================================================================== */

/* Cari baris kosong (cut point) di sekitar posisi target — titik potong irisan
   dibuat di baris yang paling sedikit teksnya agar tidak memotong baris teks. */
export function findBlankCut(ctx, w, target, winPx) {
  var h = ctx.canvas.height;
  var y0 = Math.max(0, target - winPx), y1 = Math.min(h, target + winPx);
  var best = target, bestScore = -1;
  var row = ctx.getImageData(0, y0, w, y1 - y0);
  var d = row.data;
  for (var y = y0; y < y1; y++) {
    var score = 0;
    for (var x = 0; x < w; x += 3) {
      if (d[((y - y0) * w + x) * 4] > 200) score++;
    }
    if (score > bestScore) { bestScore = score; best = y; }
  }
  return best;
}

/* Bagi canvas menjadi n irisan vertikal dengan titik potong di baris kosong.
   OVERLAP (default 120px) di kedua sisi irisan dalam — kalau kode tiket berada
   TEPAT di batas potong, irisan berdampingan tetap memuat kode UTUH sehingga
   tidak ada kode yang terpotong jadi potongan < 19 digit yang ditolak. */
export function splitCanvasV(canvas, n, overlap) {
  var ov = overlap || 120;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var w = canvas.width, h = canvas.height;
  var ch = Math.round(h / n);
  var cuts = [0];
  for (var ci = 1; ci < n; ci++) cuts.push(findBlankCut(ctx, w, ci * ch, 100));
  cuts.push(h);
  var out = [];
  for (var i = 0; i < cuts.length - 1; i++) {
    var y0 = cuts[i] - (i > 0 ? ov : 0);
    var y1 = cuts[i + 1] + (i < cuts.length - 2 ? ov : 0);
    if (y0 < 0) y0 = 0;
    if (y1 > h) y1 = h;
    if (y1 - y0 < 40) continue;
    var cc = document.createElement('canvas');
    cc.width = w; cc.height = y1 - y0;
    cc.getContext('2d').drawImage(canvas, 0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
    out.push(cc);
  }
  return out;
}
