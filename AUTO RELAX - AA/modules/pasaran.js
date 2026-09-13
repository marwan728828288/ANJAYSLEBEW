import { $, showToast } from './shared.js';

const POOL_LIST = [
  { code: "p9003", name: "KENTUCKY EVENING" },
  { code: "p9004", name: "KENTUCKY MIDDAY" },
  { code: "p1121", name: "HONGKONG LOTTO" },
  { code: "p1122", name: "SYDNEY LOTTO" },
  { code: "p1123", name: "SINGAPORE" },
  { code: "m17", name: "TOTO MACAU" },
  { code: "p14164", name: "BRUNEI 14" },
  { code: "p14165", name: "BRUNEI 21" },
  { code: "p14166", name: "BRUNEI 02" },
  { code: "p14167", name: "CHELSEA 11" },
  { code: "p14168", name: "CHELSEA 15" },
  { code: "p14169", name: "CHELSEA 19" },
  { code: "p14170", name: "CHELSEA 21" },
  { code: "p14380", name: "BANGKOK 0130" },
  { code: "p14381", name: "BANGKOK 0930" },
  { code: "p1688", name: "NORTH CAROLINA DAY" },
  { code: "p2122", name: "NEVADA" },
  { code: "p2611", name: "MAGNUM4D" },
  { code: "p4185", name: "PCSO" },
  { code: "p4186", name: "BULLSEYE" },
  { code: "p6113", name: "FLORIDA MIDDAY" },
  { code: "p6114", name: "OREGON 03" },
  { code: "p6115", name: "OREGON 06" },
  { code: "p6116", name: "OREGON 09" },
  { code: "p6117", name: "OREGON 12" },
  { code: "p6118", name: "CALIFORNIA" },
  { code: "p6119", name: "FLORIDA EVENING" },
  { code: "p6120", name: "CAROLINA EVENING" },
  { code: "p6121", name: "NEW YORK MIDDAY" },
  { code: "p6234", name: "NEW YORK EVENING" }
];

var currentCode = '';

export function initPasaran() {
  var sel = $('#pasaranSelect');
  var tbody = $('#pasaran-table-body');
  var loading = $('#pasaran-loading');
  var status = $('#pasaran-status');
  var debug = $('#pasaran-debug');
  if (!sel || !tbody) return;

  sel.innerHTML = '<option value="">-- Pilih Pasaran --</option>';
  POOL_LIST.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p.code;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  tbody.innerHTML = '<tr><td colspan="4" class="empty"><p>Pilih pasaran untuk melihat riwayat</p></td></tr>';

  sel.addEventListener('change', function() {
    currentCode = this.value;
    if (!currentCode) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty"><p>Pilih pasaran untuk melihat riwayat</p></td></tr>';
      return;
    }
    loadHistory(currentCode, tbody, loading, status);
  });
}

async function loadHistory(code, tbody, loading, status, silent) {
  if (!silent) loading.style.display = 'block';
  tbody.innerHTML = '';
  try {
    var result = await new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({ type: 'FETCH_PASARAN', code: code }, function(resp) {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(resp);
      });
    });
    if (!result || !result.rows || !result.rows.length) {
      if (result && result.error) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty"><p>Error: ' + esc(result.error) + '</p></td></tr>';
        return;
      }
      tbody.innerHTML = '<tr><td colspan="4" class="empty"><p>Tidak ada data</p></td></tr>';
      return;
    }
    if (result.debug && status) {
      var d = result.debug[0];
      status.textContent = 'DEBUG: raw=' + (d?.raw || '').substring(0, 120) + ' | cells=' + JSON.stringify(d?.cells);
    } else {
      var poolName = POOL_LIST.find(function(p) { return p.code === code; })?.name || code;
      if (status) status.textContent = poolName + ' — ' + result.rows.length + ' hasil';
    }
    tbody.innerHTML = result.rows.map(function(r) {
      var nomorHtml = esc(r.nomor).split(' | ').map(function(n) {
        return '<span style="display:inline-block;background:#1e293b;padding:2px 8px;margin:0 2px;border-radius:4px;font-weight:600;color:#fbbf24;letter-spacing:1px;">' + n + '</span>';
      }).join('');
      return '<tr><td>' + esc(r.periode) + '</td><td>' + esc(r.hari) + '</td><td>' + esc(r.tanggal) + '</td><td style="white-space:nowrap;">' + nomorHtml + '</td></tr>';
    }).join('');
  } catch (e) {
    console.error('Pasaran error:', e);
    tbody.innerHTML = '<tr><td colspan="4" class="empty"><p>Gagal memuat data</p></td></tr>';
    if (!silent) showToast('Gagal memuat riwayat', true);
  } finally {
    loading.style.display = 'none';
  }
}

function esc(str) {
  if (!str) return '-';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
