import {
  getData, withRows, writeRowsMerged, addLog, runWithConcurrency,
  bgState, pendingInvoiceTabs,
  MANUAL_MAX_CONCURRENT,
  INVOICE_TIMEOUT_MS, INVOICE_RETRY_TIMEOUT_MS, INVOICE_RETRY_MAX,
  detectAdminUrl
} from './bg-shared.js';
import { runSecureSingle } from './bg-secure.js';

let manualInterval = null;

async function runAutoRetry() {
  const { rows = [] } = await getData('rows');
  const now = Date.now();
  const pendingTabRows = new Set();
  for (const entry of pendingInvoiceTabs.values()) pendingTabRows.add(entry.row);
  const retriedIds = [];
  for (const row of rows) {
    if (!row.user || !row.kodeTiket) continue;
    if (row.payout) continue;
    if (row.autoCol10 === 'Scatter Not Found' || row.autoCol10 === 'Tidak Ditemukan Scatter' || row.autoCol10 === 'Ticket Not Found' || row.autoCol10 === 'Session Timeout' || row.manualStatus === 'Ticket Not Found' || row.manualStatus === 'Session Timeout') continue;
    const attempt = (row.autoRetryCount || 0) + 1;
    if (attempt > 3) {
      row.autoRetryCount = 999;
      row.autoCol10 = 'Tidak Ditemukan Scatter';
      row.manualStatus = '';
      row.updatedAt = now;
      retriedIds.push(row.id);
      continue;
    }
    if (row.manualStatus !== 'CHECKING' && !row.betting) continue;
    if (row.betting && row.autoRetryCount > 0) continue;
    if (!row.updatedAt || now - row.updatedAt < 10000) continue;
    if (pendingTabRows.has(row.id)) continue;
    if (bgState.manualBusyRows.has(row.id)) continue;
    row.autoRetryCount = attempt;
    row.autoCol10 = 'Auto Retry ' + attempt + 'x';
    row.manualStatus = '';
    retriedIds.push(row.id);
  }
  if (retriedIds.length) {
    /* Merge-safe: jangan menimpa baris baru yang ditambahkan panel livechat/popup
       selama snapshot ini dipegang (kelas bug yang sama dengan withRows). */
    await writeRowsMerged(rows);
    await addLog('Auto Retry: mereset ' + retriedIds.length + ' baris');
    startManualImmediate(retriedIds);
  }
}

export function startManualTimer() {
  if (manualInterval) clearInterval(manualInterval);
  manualInterval = setInterval(async () => {
    await runAutoRetry();
    if (bgState.manualRunning) return;
    bgState.manualRunning = true;
    if (bgState.manualSafetyTimeout) clearTimeout(bgState.manualSafetyTimeout);
    bgState.manualSafetyTimeout = setTimeout(() => {
      console.warn("Manual force unlock (safety 120s)");
      bgState.manualRunning = false;
    }, 120000);
    try {
      const { rows = [] } = await getData('rows');
      const pending = rows.filter(r => r.user && r.kodeTiket && !r.payout && !r.manualStatus && r.autoCol10 !== 'Scatter Not Found' && r.autoCol10 !== 'Ticket Not Found' && r.autoCol10 !== 'Session Timeout' && r.autoCol10 !== 'Tidak Ditemukan Scatter' && (r.autoRetryCount || 0) < 3 && !bgState.manualBusyRows.has(r.id));
      if (pending.length === 0) return;
      const origin = await detectAdminUrl();
      if (!origin) { console.warn("Manual timer: admin URL tidak ditemukan"); return; }
      const manualUrl = origin + '/transaction-record.html';
      const baseUrl = origin + '/keterangan-detail.html';
      await processManualBatch(pending, manualUrl, baseUrl);
    } catch (err) {
      console.error("Manual timer error:", err);
    } finally {
      if (bgState.manualSafetyTimeout) clearTimeout(bgState.manualSafetyTimeout);
      bgState.manualRunning = false;
      /* Trigger priority yang antri saat batch timer berjalan langsung diproses
         begitu batch selesai (bukan menunggu tick berikutnya). */
      drainManualPending();
    }
  }, 3000);
}

/* Antrian trigger priority yang datang saat batch sedang sibuk — diproses
   segera setelah batch berjalan selesai. Dipanggil dari finally milik
   startManualImmediate DAN startManualTimer agar antrian tidak menunggu
   tick timer berikutnya (delay ~3 dtk setelah user tempel). */
function drainManualPending() {
  if (!bgState.manualPending.size) return;
  const nextIds = Array.from(bgState.manualPending);
  bgState.manualPending.clear();
  startManualImmediate(nextIds);
}

export async function startManualImmediate(priorityIds, forceRecheck) {
  if (bgState.manualRunning) {
    if (priorityIds?.length) {
      /* INSTANT: selalu proses SEGERA (paste livechat harus langsung jalan) —
         JANGAN antri ke manualPending sampai batch yang berjalan selesai (bisa
         15-20 dtk karena timeout invoice). Aman dari double-proses: setiap batch
         menandai manualBusyRows di awal processManualBatch, jadi baris yang sedang
         diproses batch lain selalu dilewati (filter busy di semua jalur). */
      processPriorityBatch(Array.from(priorityIds), forceRecheck);
    }
    return;
  }
  bgState.manualRunning = true;
  if (bgState.manualSafetyTimeout) clearTimeout(bgState.manualSafetyTimeout);
  bgState.manualSafetyTimeout = setTimeout(() => {
    console.warn("Manual force unlock (safety 120s)");
    bgState.manualRunning = false;
  }, 120000);
  try {
    const { rows = [] } = await getData('rows');
    let pending;
    if (forceRecheck && priorityIds && priorityIds.length) {
      const idSet = new Set(priorityIds);
      pending = rows.filter(r => idSet.has(r.id) && r.user && r.kodeTiket && !r.payout && !r.manualStatus && r.autoCol10 !== 'Scatter Not Found' && !bgState.manualBusyRows.has(r.id));
    } else {
      pending = rows.filter(r => r.user && r.kodeTiket && !r.payout && !r.manualStatus && r.autoCol10 !== 'Scatter Not Found' && (r.autoRetryCount || 0) < 3 && !bgState.manualBusyRows.has(r.id));
    }
    if (pending.length === 0) return;
    if (priorityIds && priorityIds.length) {
      const prioritySet = new Set(priorityIds);
      pending = pending.filter(r => prioritySet.has(r.id));
      if (pending.length === 0) return;
    }
    const origin = await detectAdminUrl();
    if (!origin) { console.warn("Manual immediate: admin URL tidak ditemukan"); return; }
    const manualUrl = origin + '/transaction-record.html';
    const baseUrl = origin + '/keterangan-detail.html';
    await processManualBatch(pending, manualUrl, baseUrl);
  } finally {
    if (bgState.manualSafetyTimeout) clearTimeout(bgState.manualSafetyTimeout);
    bgState.manualRunning = false;
    /* Drain tanpa syarat hasOrigin — antrian tidak boleh mengendap (id basi
       tetap tersaring oleh filter !manualStatus / manualBusyRows saat diproses). */
    drainManualPending();
  }
}

async function processPriorityBatch(ids, forceRecheck) {
  /* Tanpa guard priorityRunning — trigger priority berturut-turut (paste cepat)
     boleh berjalan paralel; anti-double dijamin manualBusyRows + filter pending. */
  bgState.priorityRunning = true;
  try {
    var { rows = [] } = await getData('rows');
    var idSet = new Set(ids);
    if (forceRecheck) {
      var pending = rows.filter(function(r) { return idSet.has(r.id) && r.user && r.kodeTiket && !r.payout && !r.manualStatus && r.autoCol10 !== 'Scatter Not Found' && !bgState.manualBusyRows.has(r.id); });
    } else {
      var pending = rows.filter(function(r) { return idSet.has(r.id) && r.user && r.kodeTiket && !r.payout && !r.manualStatus && r.autoCol10 !== 'Scatter Not Found' && !bgState.manualBusyRows.has(r.id) && (r.autoRetryCount || 0) < 3; });
    }
    if (!pending.length) return;
    var origin = await detectAdminUrl();
    if (!origin) return;
    await processManualBatch(pending, origin + '/transaction-record.html', origin + '/keterangan-detail.html');
  } catch (e) { console.error('Priority batch error:', e); }
  finally {
    bgState.priorityRunning = false;
    /* Antrian yang masuk saat batch priority berjalan (paste berturut-turut) →
       langsung diproses begitu batch selesai, tidak menunggu batch lain tuntas
       (bisa sampai timeout invoice 15-20 dtk). */
    drainManualPending();
  }
}

/* Setiap baris membuat tab transaction-record.html sendiri, menunggu load,
   mencari, lalu tab DITUTUP setelah selesai (tidak dipakai bersama). */
async function searchInvoiceUrl(rowData, targetUrl, baseUrl) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: targetUrl, active: false });
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: manualPageScript,
      args: [String(rowData.user ?? ''), String(rowData.kodeTiket ?? ''), Boolean(rowData.hasTS), String(baseUrl ?? ''), Number(rowData.id)]
    });
    return execResult.result ?? { row: rowData.id, found: false };
  } catch (err) {
    console.error('Error row ' + rowData.id + ':', err);
    const txt = String(err || '');
    if (txt.includes('Session Timeout')) return { row: rowData.id, found: false, sessionTimeout: true };
    return { row: rowData.id, found: false, error: true };
  } finally {
    /* Tutup tab pencarian baris ini setelah selesai — perilaku asli. */
    if (tab) {
      chrome.tabs.get(tab.id, t => { if (!chrome.runtime.lastError && t) chrome.tabs.remove(tab.id); });
    }
  }
}

async function processManualBatch(rows, targetUrl, baseUrl) {
  /* Anti-double: baris yang sudah ditandai sibuk oleh batch LAIN (timer 3 dtk,
     TRIGGER_MANUAL paste, atau auto-retry) dilewati — cegah satu kode tiket
     diproses 2× (tab transaction-record/keterangan-detail terbuka double). */
  rows = rows.filter(r => !bgState.manualBusyRows.has(r.id));
  if (!rows.length) return;
  for (const row of rows) bgState.manualBusyRows.add(row.id);
  try {
    await withRows(allRows => {
      for (const row of rows) {
        const found = allRows.find(r => r.id === row.id);
        if (found && !found.payout) { found.manualStatus = 'CHECKING'; found.autoCol10 = 'CHECKING'; found.updatedAt = Date.now(); }
      }
    });

    const searchResult = new Map();

    async function processSingle(rowData) {
      const result = await searchInvoiceUrl(rowData, targetUrl, baseUrl);
      if (result?.sessionTimeout) {
        searchResult.set(rowData.id, { row: rowData.id, found: false, sessionTimeout: true });
      } else if (result?.found && result.url) {
        searchResult.set(rowData.id, result);
        await openInvoiceTabsAndWait([{ row: rowData.id, url: result.url, found: true }]);
      } else {
        searchResult.set(rowData.id, { row: rowData.id, found: false });
      }
    }

    await runWithConcurrency(rows, MANUAL_MAX_CONCURRENT, processSingle, 0);

    const notFoundRows = rows.filter(r => {
      const res = searchResult.get(r.id);
      return res && !res.found && !res.sessionTimeout;
    });
    const sessionTimeoutRows = rows.filter(r => {
      const res = searchResult.get(r.id);
      return res && !res.found && res.sessionTimeout;
    });
    if (sessionTimeoutRows.length > 0) {
      await withRows(curRows => {
        for (const r of sessionTimeoutRows) {
          const row = curRows.find(x => x.id === r.id);
          if (row) {
            row.manualStatus = 'Session Timeout';
            row.autoCol10 = 'Session Timeout';
            row.updatedAt = Date.now();
          }
        }
      });
      await addLog('Manual:' + sessionTimeoutRows.length + ' baris Session Timeout dari provider');
    }
    if (notFoundRows.length > 0) {
      await withRows(curRows => {
        for (const r of notFoundRows) {
          const row = curRows.find(x => x.id === r.id);
          if (row) {
            row.manualStatus = 'Ticket Not Found';
            row.autoCol10 = 'Ticket Not Found';
            row.updatedAt = Date.now();
          }
        }
      });
      await addLog('Manual:' + notFoundRows.length + ' baris invoice tidak ditemukan');
    }
  } finally {
    for (const row of rows) bgState.manualBusyRows.delete(row.id);
  }
}

async function openInvoiceTab(item, timeoutMs) {
  return new Promise(async outerResolve => {
    if (bgState.invoiceClaimed.has(item.row)) {
      outerResolve({ row: item.row, ok: true });
      return;
    }
    bgState.invoiceClaimed.add(item.row);
    let tab;
    let resolved = false;
    const safeResolve = (val) => { if (!resolved) { resolved = true; bgState.invoiceClaimed.delete(item.row); outerResolve(val); } };
    try {
      tab = await chrome.tabs.create({ url: item.url, active: false });
      function onTabUpdated(tabId, changeInfo) {
        if (tabId !== tab.id || changeInfo.status !== 'complete') return;
        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => (document.body?.innerText || '').trim()
          }).then(results => {
            const txt = results?.[0]?.result || '';
            if (txt === 'Session Timeout' || txt.includes('Session Timeout')) {
              clearTimeout(timer);
              chrome.tabs.onUpdated.removeListener(onTabUpdated);
              pendingInvoiceTabs.delete(tabId);
              safeResolve({ row: item.row, ok: false, sessionTimeout: true });
              chrome.tabs.get(tabId, t => { if (!chrome.runtime.lastError && t) chrome.tabs.remove(tabId); });
            }
          }).catch(() => {});
        }, 1500);
      }
      chrome.tabs.onUpdated.addListener(onTabUpdated);
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
        console.warn('Timeout tab ' + tab.id + 'row ' + item.row);
        pendingInvoiceTabs.delete(tab.id);
        chrome.tabs.get(tab.id, t => { if (!chrome.runtime.lastError && t) chrome.tabs.remove(tab.id); });
        safeResolve({ row: item.row, ok: false });
      }, timeoutMs);
      pendingInvoiceTabs.set(tab.id, { resolve: () => { chrome.tabs.onUpdated.removeListener(onTabUpdated); safeResolve({ row: item.row, ok: true }); }, timer: timer, row: item.row });
    } catch (err) {
      console.error('Gagal buka invoice row ' + item.row + ':', err);
      safeResolve({ row: item.row, ok: false });
    }
  });
}

async function openInvoiceTabsAndWait(foundRows) {
  const firstPass = await runWithConcurrency(foundRows, MANUAL_MAX_CONCURRENT, item => openInvoiceTab(item, INVOICE_TIMEOUT_MS), 400);
  const sessionTimeoutItems = foundRows.filter((item, idx) => firstPass[idx]?.sessionTimeout);
  let toRetry = foundRows.filter((item, idx) => !firstPass[idx]?.ok && !firstPass[idx]?.sessionTimeout);
  let attempt = 1;
  while (toRetry.length > 0 && attempt <= INVOICE_RETRY_MAX) {
    await addLog('Manual:retry invoice ' + toRetry.length + 'baris(percobaan ' + attempt + ')');
    const retryResults = await runWithConcurrency(toRetry, MANUAL_MAX_CONCURRENT, item => openInvoiceTab(item, INVOICE_RETRY_TIMEOUT_MS), 0);
    for (const [idx, item] of toRetry.entries()) {
      if (retryResults[idx]?.sessionTimeout) {
        sessionTimeoutItems.push(item);
      }
    }
    toRetry = toRetry.filter((item, idx) => !retryResults[idx]?.ok && !retryResults[idx]?.sessionTimeout);
    attempt++;
  }
  if (sessionTimeoutItems.length > 0) {
    await withRows(rows => {
      for (const item of sessionTimeoutItems) {
        const row = rows.find(r => r.id === item.row);
        if (row && row.manualStatus !== 'Session Timeout') {
          row.manualStatus = 'Session Timeout';
          row.autoCol10 = 'Session Timeout';
          row.updatedAt = Date.now();
        }
      }
    });
    await addLog('Manual:' + sessionTimeoutItems.length + ' baris Session Timeout dari provider');
  }
  if (toRetry.length > 0) {
    await withRows(rows => {
      for (const item of toRetry) {
        const row = rows.find(r => r.id === item.row);
        if (row && row.manualStatus === 'CHECKING') {
          row.manualStatus = 'Ticket Not Found';
          row.autoCol10 = 'Ticket Not Found';
          row.updatedAt = Date.now();
        }
      }
    });
    await addLog('Manual:' + toRetry.length + ' baris invoice gagal load');
  }
}

function manualPageScript(e6, l6, hasTS, baseUrl, rowNumber) {
  const xp = path => document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  const setViaPaste = (el, value) => {
    if (!el) return;
    el.focus();
    navigator.clipboard.writeText(value).catch(() => {});
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt
    }));
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const waitEl = (xpath, timeout) => {
    if (timeout === undefined) timeout = 8000;
    return new Promise((resolve, reject) => {
      const el = xp(xpath);
      if (el) return resolve(el);
      let done = false;
      const obs = new MutationObserver(() => {
        if (done) return;
        const el = xp(xpath);
        if (el) { done = true; obs.disconnect(); clearTimeout(t); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      const t = setTimeout(() => { if (!done) { done = true; obs.disconnect(); reject("Timeout: " + xpath); } }, timeout);
    });
  };  return (async () => {
    try {
      const pageText = (document.body?.innerText || '').trim();
      if (pageText === 'Session Timeout' || pageText.includes('Session Timeout')) {
        return { row: rowNumber, found: false, sessionTimeout: true };
      }
      const [inputE6, inputL6] = await Promise.all([waitEl('/html/body/div[2]/div[3]/form/div/ul/li[1]/input'), waitEl('//*[@id="transactionId"]')]);
      setViaPaste(inputE6, e6);
      setViaPaste(inputL6, l6);
      if (hasTS) {
        const d = document.querySelector('#startDate');
        if (d) {
          const cur = new Date(d.value);
          if (!isNaN(cur)) {
            cur.setDate(cur.getDate() - 1);
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (setter) {
              setter.call(d, cur.toISOString().split("T")[0]);
              d.dispatchEvent(new Event("input", { bubbles: true }));
              d.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
        }
      }
      const searchBtn = await waitEl('/html/body/div[2]/div[3]/form/div/div/a[1]');
      searchBtn.click();
      const tabBtn = await waitEl('/html/body/div[2]/div[3]/div[2]/ul/li[2]/a');
      tabBtn.click();
      const detailBtn = await waitEl('/html/body/div[2]/div[3]/div[4]/div/table/tbody/tr/td[5]/a');
      if (!detailBtn) return { row: rowNumber, found: false };
      const detailRow = detailBtn.closest('tr');
      const keteranganEl = detailRow ? detailRow.querySelector('td.dataChange[data-changekey="keterangan"]') : document.querySelector('td.dataChange[data-changekey="keterangan"]');
      const keteranganText = keteranganEl?.innerText?.trim() ?? '';
      let gamename = 65;
      if (keteranganText === 'PG-Mahjong Ways 2') gamename = 74;
      else if (keteranganText === 'PG-Mahjong Ways') gamename = 65;
      const invoiceUrl = baseUrl + '?invoice=' + encodeURIComponent(l6 + '-' + l6 + '-106-0') + '&status=03&periode=null&gamename=' + gamename + '&tablekey=7';
      return { row: rowNumber, found: true, url: invoiceUrl };
    } catch (err) {
      console.warn('manualPageScript error row ' + rowNumber + ':', err);
      const pageText = (document.body?.innerText || '').trim().toLowerCase();
      if (pageText.includes('session timeout') || pageText.includes('session expired')) {
        return { row: rowNumber, found: false, sessionTimeout: true };
      }
      return { row: rowNumber, found: false };
    }
  })();
}

export async function handleBetData(payload, tabId) {
  try {
    const foundRow = await withRows(rows => {
      const searchId = (payload.transaction || '').toString().trim();
      if (!searchId || searchId.length < 3) return null;
      let match = null;
      for (const row of rows) {
        if (!row.kodeTiket) continue;
        const tStr = row.kodeTiket.toString().replace(/\s+/g, '').trim();
        if (tStr === searchId || tStr.startsWith(searchId) || tStr.includes(searchId) || searchId.startsWith(tStr.split("-")[0])) {
          match = row;
          break;
        }
      }
      if (match) {
        if (payload.bet) match.betting = payload.bet;
        if (payload.payouts?.length) match.payout = payload.payouts.filter(p => p && p !== "0").join(" | ");
        if (payload.total_free_spin) match.totalFreeSpin = payload.total_free_spin;
        if (payload.transaction) match.transactionId = payload.transaction;
        if (payload.profit) match.profit = payload.profit;
        if (payload.balance) match.balance = payload.balance;
        if (payload.spin_type) match.spinType = payload.spin_type;
        if (payload.symbols?.length) match.symbols = payload.symbols;
        if (payload.payouts?.length) match.payoutDetail = payload.payouts;
        if (payload.free_spins?.length) match.freeSpinDetail = payload.free_spins;
        if (match.payout) {
          match.autoRetryCount = 0;
          match.autoCol10 = '';
        } else if (match.betting) {
          const attempt = (match.autoRetryCount || 0) + 1;
          match.autoRetryCount = attempt;
          if (attempt >= 3) {
            match.autoCol10 = 'Scatter Not Found';
            match.autoRetryCount = 999;
          }
        }
        match.manualStatus = '';
        match.updatedAt = Date.now();
      }
      return match ? { ...match } : null;
    });
    if (foundRow) {
      await addLog('Manual:data bet row#' + foundRow.id + 'tersimpan(' + foundRow.transactionId + ')');
      if (foundRow.user && foundRow.betting && foundRow.kodeTiket && foundRow.payoutDetail?.length) {
        /* Delay kecil agar proses invoice selesai tuntas sebelum tab bonus dibuka.
           Dipersingkat 800ms → 250ms agar proses setelah tempel lebih instant. */
        await new Promise(r => setTimeout(r, 250));
        runSecureSingle(foundRow).catch(err => console.error('Immediate process error:', err));
      }
    }
  } catch (err) {
    console.error('handleBetData error:', err);
  } finally {
    const pending = pendingInvoiceTabs.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingInvoiceTabs.delete(tabId);
      pending.resolve();
      /* Hanya tab yang DIBUKA EKSTENSI (terdaftar di pendingInvoiceTabs) yang
         ditutup otomatis setelah data terbaca. Tab "Bet Details" yang dibuka
         USER sendiri tetap terbuka — jangan ditutup paksa (permintaan user). */
      chrome.tabs.get(tabId, t => { if (!chrome.runtime.lastError && t) chrome.tabs.remove(tabId); });
    }
    /* Tab user (bukan dari pendingInvoiceTabs) → biarkan terbuka. */
  }
}
