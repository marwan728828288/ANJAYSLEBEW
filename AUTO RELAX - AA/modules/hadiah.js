export function initHadiah() {
  if (document.getElementById('ph-sel').options.length > 1) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var norm = function (s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
  var idr = function (n) { return Number(n || 0).toLocaleString('id-ID'); };

  var MARKET_LOGOS = {
    'HOKI DRAW': 'https://cdn.areabermain.club/assets/cdn/az4/2024/12/25/20241225/1de5162dbfea7a85f41b654a2c3a4d07/logo-1.png',
    'BANGKOK': 'https://bangkokpoolstoday.com/assets/img/bangkokpools_logo.png',
    'BRUNEI': 'https://bruneipools.com/assets/img/brunei-logo.png',
    'BULLSEYE': 'https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/f07d4e2a6517ef1cea9e2a897e4abb98/nz-bullseye.png',
    'CALIFORNIA': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/c89c3a35f7323e90e2e2c5c255bdb7ae/california-pools-jpg.png',
    'CAROLINA DAY': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/816329e82e136b1e9faad6d14c8c81bc/carolina-day-pools-jpg.png',
    'CAROLINA EVE': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/799cce2ab08aca8bfb3a4a9c7484d78e/carolina-eve-jpg.png',
    'CHELSEA': 'https://chelseapools.co.uk/assets/img/chelseaPools_logo.png',
    'FLORIDA EVE': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/801479ca02e15020fac8df0024814152/florida-eve-new-2.png',
    'FLORIDA MID': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/1ffa2459adcc8330fa8874792d59eb1a/florida-mid.png',
    'HONGKONG': 'https://cdn.animaapp.com/projects/66be29ddeca4d2e95aa7b4ce/releases/66be3e204d8f7eb28bb5de15/img/hongkong-lotto-1.png',
    'HUAHIN': 'https://huahinlottery.com/assets/img/logo.png',
    'KENTUCKY EVE': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/ae8e720c8b7d930856cf3f364cc10158/kentucky-eve.png',
    'KENTUCKY MID': 'https://kentuckymid.com/wp-content/uploads/2022/07/KENTUCKY-MID.png',
    'MAGNUM4D': 'https://cdn.areabermain.club/assets/cdn/az4/2024/08/11/20240811/8889f1c5fc738b5148145100c08a0ebc/439-4390693-magnum-pengeluaran-magnum-4d-hari-clipart-removebg-preview.png',
    'NEVADA': 'https://www.nevadalottery.us/images/logo.gif',
    'NEW YORK EVE': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/1f9a654060201e07442bc78def1bc135/new-york-eve.png',
    'NEW YORK MID': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/7fb415d09885f1a79bfc30b48803cc4d/new-york-mid.png',
    'OREGON': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/7715823646164db9d67d280a402dfb51/oregon-jpg.png',
    'PCSO': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/a67d9fd134f7211cbe08bd89bd64f79d/pcso-2.png',
    'POIPET': 'https://poipetlottery.com/img/logo.png',
    'SINGAPORE': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/ae20d56fcb2d0dea6b0ae637c6bed566/singapore-new.png',
    'SYDNEY': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/1d9ba1f974240b7b5c5e48fa2ef98e0e/sydney-2.png',
    'TOTOMALI': 'https://totomali.com/assets/img/logo.svg',
    'TOTO MACAU 4D': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/033094b5e73f842fcbcc3b235c029e7c/macau-logo.png',
    'KINGKONG': 'https://cdn.areabermain.club/assets/cdn/az4/2025/08/18/20250818/32f87d6c932b0d2eee9b6e1c9028ab41/logo-2.png',
    'TOTO CAMBODIA': 'https://totocambodialive.com/assets/img/logo.png'
  };

  var KEI_MINUS = {
    'silang homo': 1, '50 - 50': 1, 'tengah tepi': 1,
    'kembang - kempis - kembar': 1, 'dasar ganjil - besar': 1
  };
  var KEI_PLUS = { 'dasar genap - kecil': 1 };

  function isPlusTotal(title) {
    var t = norm(title);
    return /^colok bebas/.test(t) || /^colok bebas 2d/.test(t) ||
           /^colok bebas 4d/.test(t) || /^colok jitu/.test(t) ||
           /^colok naga/.test(t) || /^shio$/.test(t) || /^kombinasi$/.test(t);
  }

  function tagOf(title) {
    var t = norm(title);
    if (t.indexOf('super diskon') === 0 || t.indexOf('diskon') === 0) return 'diskon';
    if (t.indexOf('bet full') === 0) return 'betfull';
    if (t.indexOf('prize') === 0) return 'prize';
    if (t.indexOf('tepat') > -1 || /\bbb\b/.test(t)) return 'tepatbb';
    return 'lain';
  }

  function prizeBlock(p14, p13, p12, p24, p23, p22, p34, p33, p32) {
    var o = {};
    o['PRIZE 1 - 4D'] = { hadiah: p14, diskon: 0 };
    o['PRIZE 1 - 3D'] = { hadiah: p13, diskon: 0 };
    o['PRIZE 1 - 2D'] = { hadiah: p12, diskon: 0 };
    o['PRIZE 2 - 4D'] = { hadiah: p24, diskon: 0 };
    o['PRIZE 2 - 3D'] = { hadiah: p23, diskon: 0 };
    o['PRIZE 2 - 2D'] = { hadiah: p22, diskon: 0 };
    o['PRIZE 3 - 4D'] = { hadiah: p34, diskon: 0 };
    o['PRIZE 3 - 3D'] = { hadiah: p33, diskon: 0 };
    o['PRIZE 3 - 2D'] = { hadiah: p32, diskon: 0 };
    return o;
  }

  var CFG = {};

  function cfg(market, params) {
    CFG[market] = { strict: true, prizeAvailable: !!params.prize, overrides: params.map || {} };
  }

  cfg('HOKI DRAW', {
    prize: false,
    map: {
      'DISKON 5D': { hadiah: 50000, diskon: 38 }, 'DISKON 4D': { hadiah: 7000, diskon: 20 },
      'DISKON 3D': { hadiah: 750, diskon: 20 }, 'DISKON 2D': { hadiah: 75, diskon: 20 },
      'BET FULL 5D': { hadiah: 88000 }, 'BET FULL 4D': { hadiah: 10000 },
      'BET FULL 3D': { hadiah: 1000 }, 'BET FULL 2D': { hadiah: 100 },
      '5D TEPAT': { hadiah: 50000 }, '5D BB': { hadiah: 350 },
      '4D TEPAT': { hadiah: 5000 }, '4D BB': { hadiah: 180 },
      '3D TEPAT': { hadiah: 500 }, '3D BB': { hadiah: 75 },
      '2D TEPAT': { hadiah: 80 }, '2D BB': { hadiah: 15 },
      'COLOK BEBAS ( 1 DIGIT )': { hadiah: 0.9, diskon: 6 }, 'COLOK BEBAS ( 2 DIGIT )': { hadiah: 1.8, diskon: 6 },
      'COLOK BEBAS ( 3 DIGIT )': { hadiah: 2.7, diskon: 6 }, 'COLOK BEBAS ( 4 DIGIT )': { hadiah: 3.6, diskon: 6 },
      'COLOK BEBAS ( 5 DIGIT )': { hadiah: 4.5, diskon: 6 }, 'COLOK JITU': { hadiah: 8, diskon: 6 },
      'COLOK BEBAS 2D ( 2 DIGIT )': { hadiah: 4, diskon: 10 }, 'COLOK BEBAS 2D ( 3 DIGIT )': { hadiah: 6, diskon: 10 },
      'COLOK BEBAS 2D ( 4 DIGIT )': { hadiah: 20, diskon: 10 }, 'COLOK BEBAS 2D ( 5 DIGIT )': { hadiah: 200, diskon: 10 },
      'COLOK BEBAS 4D ( 4 DIGIT )': { hadiah: 50, diskon: 10 }, 'COLOK BEBAS 4D ( 5 DIGIT )': { hadiah: 200, diskon: 10 },
      'COLOK NAGA ( 3 DIGIT )': { hadiah: 12, diskon: 10 }, 'COLOK NAGA ( 4 DIGIT )': { hadiah: 30, diskon: 10 },
      'COLOK NAGA ( 5 DIGIT )': { hadiah: 125, diskon: 10 }, 'SHIO': { hadiah: 9.5, diskon: 5 },
      '50 - 50': { kei: -2.2, diskon: 2 }, 'KOMBINASI': { hadiah: 2.7, diskon: 8 },
      'TENGAH TEPI': { kei: -2.2, diskon: 2 }, 'DASAR GANJIL - BESAR': { kei: -25, diskon: 2 },
      'DASAR GENAP - KECIL': { kei: 10, diskon: 2 }
    }
  });

  var BASE_MAP = {
    'DISKON 4D': { hadiah: 3000, diskon: 66.5 }, 'DISKON 3D': { hadiah: 400, diskon: 59.5 },
    'DISKON 2D': { hadiah: 70, diskon: 29.5 }, 'DISKON 2D DEPAN': { hadiah: 65, diskon: 29.5 },
    'DISKON 2D TENGAH': { hadiah: 65, diskon: 29.5 },
    'BET FULL 4D': { hadiah: 10000, diskon: 0 }, 'BET FULL 3D': { hadiah: 1000, diskon: 0 },
    'BET FULL 2D': { hadiah: 100, diskon: 0 },
    '4D TEPAT': { hadiah: 4000 }, '4D BB': { hadiah: 200 },
    '3D TEPAT': { hadiah: 400 }, '3D BB': { hadiah: 100 },
    '2D TEPAT': { hadiah: 70 }, '2D BB': { hadiah: 20 },
    'COLOK BEBAS ( 1 DIGIT )': { hadiah: 1.5, diskon: 6 }, 'COLOK BEBAS ( 2 DIGIT )': { hadiah: 3, diskon: 6 },
    'COLOK BEBAS ( 3 DIGIT )': { hadiah: 4.5, diskon: 6 }, 'COLOK BEBAS ( 4 DIGIT )': { hadiah: 6, diskon: 6 },
    'COLOK JITU': { hadiah: 8, diskon: 6 },
    'COLOK BEBAS 2D ( 2 DIGIT )': { hadiah: 7, diskon: 10 }, 'COLOK BEBAS 2D ( 3 DIGIT )': { hadiah: 11, diskon: 10 },
    'COLOK BEBAS 2D ( 4 DIGIT )': { hadiah: 18, diskon: 10 },
    'COLOK NAGA ( 3 DIGIT )': { hadiah: 23, diskon: 10 }, 'COLOK NAGA ( 4 DIGIT )': { hadiah: 35, diskon: 10 },
    'SHIO': { hadiah: 9.5, diskon: 5 },
    '50 - 50': { kei: -3, diskon: 2 }, 'TENGAH TEPI': { kei: -3, diskon: 2 },
    'SILANG HOMO': { kei: -3, diskon: 2 }, 'KEMBANG - KEMPIS - KEMBAR': { kei: -3, diskon: 2 },
    'KOMBINASI': { hadiah: 2.6, diskon: 8 },
    'DASAR GANJIL - BESAR': { kei: -25, diskon: 2 }, 'DASAR GENAP - KECIL': { kei: 10, diskon: 2 }
  };

  ['BANGKOK', 'BRUNEI', 'CHELSEA', 'HONGKONG', 'HUAHIN', 'MAGNUM4D', 'NEVADA', 'POIPET', 'SYDNEY', 'TOTO CAMBODIA', 'TOTOMALI', 'TOTO MACAU 4D', 'KINGKONG'].forEach(function (name) {
    var m = {};
    for (var k in BASE_MAP) { if (BASE_MAP.hasOwnProperty(k)) m[k] = JSON.parse(JSON.stringify(BASE_MAP[k])); }
    if (name === 'KINGKONG') { m['DISKON 4D'] = { hadiah: 6000, diskon: 33 }; m['DISKON 3D'] = { hadiah: 700, diskon: 24 }; m['DISKON 2D'] = { hadiah: 80, diskon: 15 }; }
    if (name === 'TOTOMALI') {
      m['DISKON 4D'] = { hadiah: 3000, diskon: 67 }; m['DISKON 3D'] = { hadiah: 400, diskon: 57 };
      m['DISKON 2D'] = { hadiah: 70, diskon: 27 }; delete m['DISKON 2D DEPAN']; delete m['DISKON 2D TENGAH'];
      m['COLOK BEBAS ( 1 DIGIT )'] = { hadiah: 1.6, diskon: 6 }; m['COLOK BEBAS ( 2 DIGIT )'] = { hadiah: 3.2, diskon: 6 };
      m['COLOK BEBAS ( 3 DIGIT )'] = { hadiah: 4.8, diskon: 6 }; m['COLOK BEBAS ( 4 DIGIT )'] = { hadiah: 6.4, diskon: 6 };
      m['COLOK JITU'] = { hadiah: 8.3, diskon: 6 };
      m['COLOK BEBAS 2D ( 2 DIGIT )'] = { hadiah: 7, diskon: 10 }; m['COLOK BEBAS 2D ( 3 DIGIT )'] = { hadiah: 13, diskon: 10 };
      m['COLOK BEBAS 2D ( 4 DIGIT )'] = { hadiah: 21, diskon: 10 };
      m['COLOK NAGA ( 3 DIGIT )'] = { hadiah: 27, diskon: 10 }; m['COLOK NAGA ( 4 DIGIT )'] = { hadiah: 41, diskon: 10 };
      m['SHIO'] = { hadiah: 10, diskon: 5 };
    }
    var p = prizeBlock(6500, 650, 70, 2100, 210, 20, 1100, 110, 8);
    for (var pk in p) { if (p.hasOwnProperty(pk)) m[pk] = p[pk]; }
    cfg(name, { prize: true, map: m });
  });

  var NO_PRIZE_NAMES = ['BULLSEYE', 'CALIFORNIA', 'CAROLINA EVE', 'CAROLINA DAY', 'FLORIDA EVE', 'FLORIDA MID', 'KENTUCKY EVE', 'KENTUCKY MID', 'NEW YORK EVE', 'NEW YORK MID', 'OREGON', 'PCSO'];
  NO_PRIZE_NAMES.forEach(function (name) {
    var m = {};
    for (var k in BASE_MAP) { if (BASE_MAP.hasOwnProperty(k)) m[k] = JSON.parse(JSON.stringify(BASE_MAP[k])); }
    cfg(name, { prize: false, map: m });
  });

  (function () {
    var m = {};
    for (var k in BASE_MAP) { if (BASE_MAP.hasOwnProperty(k)) m[k] = JSON.parse(JSON.stringify(BASE_MAP[k])); }
    var p = prizeBlock(6500, 650, 70, 2100, 210, 20, 1100, 110, 8);
    for (var pk in p) { if (p.hasOwnProperty(pk)) m[pk] = p[pk]; }
    cfg('SINGAPORE', { prize: true, map: m });
  })();

  var markets = [
    'TOTO MACAU 4D', 'KINGKONG', 'BANGKOK', 'BRUNEI',
    'CHELSEA', 'HONGKONG', 'HUAHIN', 'MAGNUM4D', 'NEVADA', 'POIPET',
    'SYDNEY', 'TOTO CAMBODIA', 'BULLSEYE', 'CALIFORNIA', 'CAROLINA EVE',
    'CAROLINA DAY', 'FLORIDA EVE', 'FLORIDA MID', 'KENTUCKY EVE',
    'KENTUCKY MID', 'NEW YORK EVE', 'NEW YORK MID', 'OREGON', 'PCSO',
    'SINGAPORE', 'HOKI DRAW', 'TOTOMALI'
  ];

  var sel = document.getElementById('ph-sel');
  markets.forEach(function (market) {
    var opt = document.createElement('option');
    opt.value = market; opt.textContent = market;
    sel.appendChild(opt);
  });

  var current = '';
  var filter = 'all';

  function itemsFor(market) {
    var config = CFG[market] || null;
    if (!config) return { items: [], prize: false };
    var items = [];
    for (var key in config.overrides) {
      if (!config.overrides.hasOwnProperty(key)) continue;
      var override = config.overrides[key] || {};
      items.push({ title: key, hadiah: override.hadiah, diskon: override.diskon, kei: override.kei });
    }
    return { items: items, prize: config.prizeAvailable };
  }

  function getMinBet(gameTitle, gameTag) { return gameTag === 'lain' ? 1000 : 100; }

  function createCard(game) {
    var title = norm(game.title);
    var gameTag = tagOf(game.title);
    var isKei = !!KEI_MINUS[title] || !!KEI_PLUS[title] || (game.kei != null);
    var diskon = Number(game.diskon || 0);
    var hadiah = Number(game.hadiah || 0);
    var kei = isKei ? Number(game.kei || 0) : 0;
    var minBet = getMinBet(game.title, gameTag);

    var card = document.createElement('div');
    card.className = 'ph-card';
    card.dataset.tag = gameTag;

    var h3 = document.createElement('h3');
    h3.textContent = game.title + ' :';
    if (norm((game.title || '').replace(/[-]/g, '-')) === 'kembang - kempis - kembar') {
      h3.style.fontSize = '13px';
    }

    var meta = document.createElement('div');
    meta.className = 'ph-meta';
    meta.textContent = isKei
      ? ('Diskon : ' + (diskon||0) + '% | Kei : ' + (kei>=0?'+':'') + (kei||0) + '%')
      : ('Diskon : ' + (diskon||0) + '% | Hadiah : x' + (hadiah||'-'));

    var row = document.createElement('div');
    row.className = 'ph-row';
    var input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.placeholder = 'Input Nominal Taruhan (Min: ' + idr(minBet) + ')';
    input.min = minBet; input.step = 'any';
    row.appendChild(input);

    var actions = document.createElement('div');
    actions.className = 'ph-actions';
    var btnHitung = document.createElement('button');
    btnHitung.type = 'button'; btnHitung.className = 'ph-btn ph-hitung';
    btnHitung.innerHTML = '<i class="fas fa-calculator"></i> HITUNG';
    var btnReset = document.createElement('button');
    btnReset.type = 'button'; btnReset.className = 'ph-btn ph-reset';
    btnReset.innerHTML = '<i class="fas fa-redo"></i> RESET';
    actions.append(btnHitung, btnReset);

    var output = document.createElement('div');
    output.className = 'ph-out';
    var pillPay = document.createElement('div'); pillPay.className = 'ph-pill ph-pay';
    pillPay.textContent = 'Jika anda melakukan bettingan pada ' + game.title + ' maka yang anda harus BAYAR : -';
    var pillWin = document.createElement('div'); pillWin.className = 'ph-pill ph-win';
    pillWin.textContent = 'Jika anda menang, maka anda akan di bayarkan : -';
    var pillSum = document.createElement('div'); pillSum.className = 'ph-pill ph-sum';
    pillSum.style.display = 'none';
    pillSum.textContent = 'Total hadiah yang di dapatkan di tambah dengan modal awal : -';
    var pillMin = document.createElement('div'); pillMin.className = 'ph-pill ph-min';
    pillMin.textContent = 'MIN : ' + idr(minBet);
    output.append(pillPay, pillWin, pillSum, pillMin);

    var calcTable = document.createElement('div');
    calcTable.className = 'ph-calc-table';
    var calcTitle = document.createElement('h4');
    calcTitle.textContent = 'Cara Perhitungan:';
    calcTable.appendChild(calcTitle);

    var cardHeader = document.createElement('div'); cardHeader.style.cssText = 'flex:0 0 auto';
    cardHeader.append(h3, meta);
    var cardContent = document.createElement('div'); cardContent.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:column;gap:12px;';
    cardContent.append(row, actions);
    var cardFooter = document.createElement('div'); cardFooter.style.cssText = 'flex:0 0 auto';
    cardFooter.append(output, calcTable);
    card.append(cardHeader, cardContent, cardFooter);

    function showMin() {
      output.classList.add('show');
      pillMin.style.display = 'block'; pillMin.textContent = 'MIN : ' + idr(minBet);
      pillPay.style.display = 'none'; pillWin.style.display = 'none'; pillSum.style.display = 'none';
    }

    function showResult(bayar, menang, total, showTotal, calcSteps) {
      output.classList.add('show');
      pillMin.style.display = 'none';
      pillPay.style.display = 'block';
      pillPay.textContent = 'Jika anda melakukan bettingan pada ' + game.title + ' maka yang anda harus BAYAR : ' + idr(bayar);
      pillWin.style.display = 'block';
      pillWin.textContent = 'Jika anda menang, maka anda akan di bayarkan : ' + idr(menang);
      pillSum.style.display = showTotal ? 'block' : 'none';
      pillSum.textContent = 'Total hadiah yang di dapatkan di tambah dengan modal awal : ' + idr(total);
      calcTable.innerHTML = ''; calcTitle.textContent = 'Cara Perhitungan:';
      calcTable.appendChild(calcTitle);
      if (calcSteps && calcSteps.length > 0) {
        calcSteps.forEach(function (step) {
          var stepDiv = document.createElement('div');
          stepDiv.className = 'ph-calc-step'; stepDiv.innerHTML = step;
          calcTable.appendChild(stepDiv);
        });
        calcTable.classList.add('show');
      }
    }

    btnHitung.addEventListener('click', function () {
      var value = parseFloat(input.value);
      if (isNaN(value) || value <= 0 || value < minBet) {
        showMin();
        return;
      }
      var calcSteps = [];
      if (isKei) {
        var isMinus = /^(silang homo|50 - 50|tengah tepi|kembang - kempis - kembar|dasar ganjil - besar)$/i.test(title) || (game.kei != null && game.kei < 0);
        var bayar, menang, total;
        if (isMinus) {
          var pre = value + value * Math.abs(kei) / 100;
          bayar = Math.ceil(pre * (1 - (diskon||0) / 100));
          menang = Math.round(value);
          calcSteps = [
            '1. Modal awal: <span class="result">' + idr(value) + '</span>',
            '2. Tambah kei minus: <span class="formula">' + idr(value) + ' + ' + Math.abs(kei) + '% = ' + idr(pre) + '</span>',
            '3. Yang dibayar (setelah diskon): <span class="formula">' + idr(pre) + ' - ' + (diskon||0) + '% = ' + idr(bayar) + '</span>',
            '4. Hadiah jika menang: <span class="result">' + idr(menang) + '</span>'
          ];
        } else {
          bayar = Math.round(value * (1 - (diskon||0) / 100));
          menang = Math.round(value + value * ((kei||0) / 100));
          calcSteps = [
            '1. Modal awal: <span class="result">' + idr(value) + '</span>',
            '2. Yang dibayar (setelah diskon): <span class="formula">' + idr(value) + ' - ' + (diskon||0) + '% = ' + idr(bayar) + '</span>',
            '3. Hadiah jika menang: <span class="formula">' + idr(value) + ' + ' + (kei||0) + '% = ' + idr(menang) + '</span>'
          ];
        }
        total = bayar + menang;
        calcSteps.push('5. Total jika menang: <span class="result">' + idr(bayar) + ' + ' + idr(menang) + ' = ' + idr(total) + '</span>');
        showResult(bayar, menang, total, true, calcSteps);
      } else {
        var bayar = Math.round(value * (1 - (diskon||0) / 100));
        var menang = Math.round(value * (hadiah||0));
        var total = bayar + menang;
        calcSteps = [
          '1. Modal awal: <span class="result">' + idr(value) + '</span>',
          '2. Yang dibayar (setelah diskon): <span class="formula">' + idr(value) + ' - ' + (diskon||0) + '% = ' + idr(bayar) + '</span>',
          '3. Hadiah jika menang: <span class="formula">' + idr(value) + ' × ' + (hadiah||0) + ' = ' + idr(menang) + '</span>'
        ];
        var isColokBebas = /^colok bebas/.test(title);
        if (isPlusTotal(game.title) || isColokBebas) {
          calcSteps.push('4. Total jika menang: <span class="result">' + idr(bayar) + ' + ' + idr(menang) + ' = ' + idr(total) + '</span>');
          showResult(bayar, menang, total, true, calcSteps);
        } else {
          showResult(bayar, menang, total, false, calcSteps);
        }
      }
    });

    btnReset.addEventListener('click', function () {
      input.value = ''; output.classList.remove('show'); calcTable.classList.remove('show');
    });

    input.addEventListener('keypress', function (e) { if (e.key === 'Enter') btnHitung.click(); });
    return card;
  }

  function render() {
    var grid = document.getElementById('ph-grid');
    var empty = document.getElementById('ph-empty');
    var info = document.getElementById('ph-info');

    if (!current) {
      empty.style.display = 'block'; empty.textContent = 'Silakan pilih pasaran di atas.';
      grid.innerHTML = ''; info.innerHTML = ''; return;
    }
    empty.style.display = 'none';
    info.innerHTML = '';

    var marketBox = document.createElement('div');
    marketBox.className = 'ph-market-box';
    var logoURL = MARKET_LOGOS[current];
    if (logoURL) {
      var logo = document.createElement('img');
      logo.src = logoURL; logo.alt = current + ' logo'; logo.className = 'ph-market-logo'; logo.loading = 'lazy';
      marketBox.appendChild(logo);
    } else {
      var label = document.createElement('span'); label.textContent = current;
      marketBox.appendChild(label);
    }
    info.appendChild(marketBox);

    var data = itemsFor(current);
    var items = data.items;
    var hasPrize = data.prize;

    var prizeTab = document.querySelector('#ph-tabs .ph-tab[data-k="prize"]');
    if (prizeTab) prizeTab.style.display = hasPrize ? '' : 'none';

    var hasOther = items.some(function (game) { return tagOf(game.title) === 'lain'; });
    var otherTab = document.querySelector('#ph-tabs .ph-tab[data-k="lain"]');
    if (otherTab) otherTab.style.display = hasOther ? '' : 'none';

    var list = [];
    items.forEach(function (game) {
      var tag = tagOf(game.title);
      if (filter !== 'all' && tag !== filter) return;
      list.push({ g: game, tag: tag });
    });

    grid.innerHTML = '';
    if (filter === 'all') {
      var order = ['diskon', 'betfull', 'prize', 'tepatbb', 'lain'];
      var titleMap = { diskon: 'Diskon', betfull: 'Bet Full', prize: 'Prize 123', tepatbb: 'Tepat & BB', lain: 'Lainnya' };
      order.forEach(function (tag) {
        var subList = list.filter(function (x) { return x.tag === tag; });
        if (!subList.length) return;
        var divider = document.createElement('div');
        divider.className = 'ph-divider';
        var label = document.createElement('span');
        label.className = 'ph-divider-label'; label.textContent = titleMap[tag];
        divider.appendChild(label); grid.appendChild(divider);
        subList.forEach(function (x) { grid.appendChild(createCard(x.g)); });
      });
    } else {
      list.forEach(function (x) { grid.appendChild(createCard(x.g)); });
    }

    if (!grid.children.length) {
      empty.style.display = 'block'; empty.textContent = 'Tidak ada kartu untuk ditampilkan.';
    }
  }

  var tabsContainer = document.getElementById('ph-tabs');
  var tabData = [
    { k: 'all', label: 'SEMUA' },
    { k: 'diskon', label: 'DISKON' },
    { k: 'betfull', label: 'BET FULL' },
    { k: 'prize', label: 'PRIZE 123' },
    { k: 'tepatbb', label: 'TEPAT & BB' },
    { k: 'lain', label: 'LAINNYA' }
  ];
  tabData.forEach(function (td) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ph-tab' + (td.k === 'all' ? ' active' : '');
    btn.dataset.k = td.k;
    btn.textContent = td.label;
    btn.addEventListener('click', function () {
      $$('.ph-tab').forEach(function (x) { x.classList.remove('active'); });
      btn.classList.add('active');
      filter = btn.dataset.k;
      render();
    });
    tabsContainer.appendChild(btn);
  });

  sel.addEventListener('change', function (e) {
    current = (e.target.value || '').toUpperCase();
    render();
  });
  sel.addEventListener('input', function (e) {
    current = (e.target.value || '').toUpperCase();
    render();
  });

  current = '';
  sel.value = '';
  render();
}
