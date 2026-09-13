export function initParlay() {
  var parlays = [], counter = 0;

  function calcOx(odds, hasil) {
    var o = parseFloat(odds) || 1, h = parseFloat(hasil);
    if (h === 1) return o;
    if (h === 0.5) return ((o - 1) / 2) + 1;
    if (h === -0.5) return 0.5;
    return 1;
  }

  function updateTotals() {
    var tot = 1;
    parlays.forEach(function (p) {
      p.oddsx = parseFloat(calcOx(p.odds, p.hasil).toFixed(4));
      tot *= p.oddsx;
      var s = document.getElementById('pp-ox-' + p.id);
      if (s) s.textContent = p.oddsx;
    });
    tot = parseFloat(tot.toFixed(2));
    var bet = parseFloat(document.getElementById('pp-bet').value) || 0;
    document.getElementById('pp-odds-display').textContent = tot;
    document.getElementById('pp-hasil-display').textContent = parseFloat((bet * tot - bet).toFixed(2));
    document.getElementById('pp-count').textContent = parlays.length;
  }

  function getParlayId(el) {
    while (el && el.id && el.id.indexOf('pp-row-') !== 0) el = el.parentElement;
    if (!el) return null;
    return parseInt(el.id.replace('pp-row-', ''), 10);
  }

  function addParlay() {
    counter++;
    var id = counter;
    parlays.push({ id: id, odds: 1, hasil: '1', oddsx: 1 });
    var d = document.createElement('div');
    d.className = 'pp-row'; d.id = 'pp-row-' + id;
    d.innerHTML =
      '<div class="pp-col-del">' +
        '<span class="pp-lbl">&nbsp;</span>' +
        '<button class="pp-btn-del" data-action="del"><i class="fas fa-trash"></i></button>' +
      '</div>' +
      '<div class="pp-col-odds">' +
        '<span class="pp-lbl"><i class="fas fa-chart-line"></i> Odds</span>' +
        '<input type="number" class="pp-input pp-odds-input" data-id="' + id + '" value="1" step="0.01">' +
      '</div>' +
      '<div class="pp-col-hasil">' +
        '<span class="pp-lbl"><i class="fas fa-flag-checkered"></i> Hasil Partai</span>' +
        '<div class="pp-radio-wrap">' +
          '<label class="pp-radio"><input type="radio" name="pp-h-' + id + '" value="1" data-id="' + id + '" checked> Menang Full</label>' +
          '<label class="pp-radio"><input type="radio" name="pp-h-' + id + '" value="0.5" data-id="' + id + '"> Menang &frac12;</label>' +
          '<label class="pp-radio"><input type="radio" name="pp-h-' + id + '" value="-0.5" data-id="' + id + '"> Kalah &frac12;</label>' +
          '<label class="pp-radio"><input type="radio" name="pp-h-' + id + '" value="0" data-id="' + id + '"> Seri</label>' +
        '</div>' +
        '<div class="pp-odds-info"><i class="fas fa-info-circle"></i> Hasil Odds: <strong id="pp-ox-' + id + '">1</strong></div>' +
      '</div>';
    document.getElementById('pp-list').appendChild(d);
    updateTotals();
  }

  document.getElementById('pp-list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action="del"]');
    if (!btn) return;
    var id = getParlayId(btn);
    if (!id || parlays.length <= 1) return;
    parlays = parlays.filter(function (p) { return p.id !== id; });
    var r = document.getElementById('pp-row-' + id);
    if (r) r.parentNode.removeChild(r);
    updateTotals();
  });

  document.getElementById('pp-list').addEventListener('input', function (e) {
    var inp = e.target.closest('.pp-odds-input');
    if (!inp) return;
    var id = parseInt(inp.getAttribute('data-id'), 10);
    parlays.forEach(function (p) { if (p.id === id) p.odds = inp.value; });
    updateTotals();
  });

  document.getElementById('pp-list').addEventListener('change', function (e) {
    var radio = e.target.closest('input[type="radio"]');
    if (!radio) return;
    var id = parseInt(radio.getAttribute('data-id'), 10);
    parlays.forEach(function (p) { if (p.id === id) p.hasil = radio.value; });
    updateTotals();
  });

  document.getElementById('pp-tambah').onclick = addParlay;
  document.getElementById('pp-catatan-btn').onclick = function () {
    var el = document.getElementById('pp-catatan');
    el.style.display = (el.style.display === 'none') ? 'block' : 'none';
  };
  document.getElementById('pp-rumus-btn').onclick = function () {
    var el = document.getElementById('pp-rumus');
    el.style.display = (el.style.display === 'none') ? 'block' : 'none';
  };
  document.getElementById('pp-bet').oninput = updateTotals;

  addParlay(); addParlay(); addParlay();
}
