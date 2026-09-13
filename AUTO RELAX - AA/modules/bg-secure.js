import {
  getData, setData, withRows, addLog, runWithConcurrency,
  bgState,
  MAX_SECURE_CONCURRENT, SECURE_RETRY_SCATTER_MAX, SECURE_SINGLE_MAX
} from './bg-shared.js';

export async function securePollAutomation() {
  if (bgState.secureIsRunning) return;
  bgState.secureIsRunning = true;
  try {
    const { rows = [] } = await getData('rows');
    const pending = rows.filter(r => {
      if (!r.user || !r.betting || !r.kodeTiket || r.secureStatus) return false;
      if (r.createdAt && Date.now() - r.createdAt <= 60000) return false;
      let sv = null;
      if (r.payoutDetail && r.payoutDetail.length > 0) { const p = parseInt(r.payoutDetail[0], 10); if (!isNaN(p)) sv = p; }
      else if (typeof r.payout === 'string' && r.payout) { const p = parseInt(r.payout.split(' | ')[0], 10); if (!isNaN(p)) sv = p; }
      if (sv !== null && sv > 5) sv = 5;
      return sv !== null && [3, 4, 5].includes(sv);
    });
    if (pending.length === 0) return;
    const dataRows = pending.map(r => {
      let scatterVal = null;
      if (r.payoutDetail && r.payoutDetail.length > 0) {
        const parsed = parseInt(r.payoutDetail[0], 10);
        if (!isNaN(parsed)) scatterVal = parsed;
      } else if (typeof r.payout === 'string' && r.payout) {
        const first = r.payout.split(' | ')[0];
        const parsed = parseInt(first, 10);
        if (!isNaN(parsed)) scatterVal = parsed;
      }
      if (scatterVal !== null && scatterVal > 5) scatterVal = 5;
      else if (scatterVal === null || ![3, 4, 5].includes(scatterVal)) scatterVal = null;
      return { rowNumber: r.id, url: 'https://bonussmb.com/tickets', userId: r.user, kodeTiket: r.kodeTiket, betting: r.betting, scatter: scatterVal !== null ? String(scatterVal) : null, hasTS: !!r.hasTS };
    });
    const validRows = dataRows.filter(r => r.scatter !== null);
    if (validRows.length === 0) return;
    await processSecureBatch(validRows, 'https://bonussmb.com/tickets');
  } catch (err) {
    console.error("Error secure automation:", err);
  } finally {
    bgState.secureIsRunning = false;
  }
}

export function isScatterNotFound(message) {
  return message === 'Scatter tidak valid atau tidak ditemukan';
}

export async function applySecureResult(result) {
  if (!result?.rowNumber || !result?.message) return;
  const updated = await withRows(curRows => {
    const row = curRows.find(x => x.id === result.rowNumber);
    if (row) { row.secureStatus = result.message; row.updatedAt = Date.now(); return true; }
    return false;
  });
  if (updated) await addLog('Secure:row#' + result.rowNumber + '\u2192"' + result.message + '"');
}

async function runSecureRow(rowData, url) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: url, active: false });
    await new Promise((res, rej) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); rej(new Error('Tab load timeout')); }, 10000);
      function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); res(); }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
    await new Promise(r => setTimeout(r, 1000));
    const [execResult] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: automateForm, args: [rowData] });
    return execResult?.result ?? null;
  } catch (err) {
    console.error('Secure error row ' + rowData.rowNumber + ':', err);
    return { rowNumber: rowData.rowNumber, message: 'Tab Ticket terganggu silakan coba lagi' };
  } finally {
    if (tab?.id) { try { chrome.tabs.remove(tab.id); } catch (_) {} }
  }
}

async function processSecureBatch(rows, url) {
  for (let i = 0; i < rows.length; i += MAX_SECURE_CONCURRENT) {
    const chunk = rows.slice(i, i + MAX_SECURE_CONCURRENT);
    await withRows(allRows => {
      for (const r of chunk) {
        const found = allRows.find(x => x.id === r.rowNumber);
        if (found && !found.secureStatus) { found.secureStatus = 'PROCESSING'; found.updatedAt = Date.now(); }
      }
    });
    const results = await Promise.all(chunk.map(async (rowData, idx) => {
      await new Promise(r => setTimeout(r, idx < 2 ? 500 : 0));
      const result = await runSecureRow(rowData, url);
      if (result) await applySecureResult(result);
      return result;
    }));
    let toRetry = chunk.filter((rowData, idx) => isScatterNotFound(results[idx]?.message));
    let attempt = 1;
    while (toRetry.length > 0 && attempt <= SECURE_RETRY_SCATTER_MAX) {
      await addLog('Secure:retry scatter ' + toRetry.length + 'baris(percobaan ' + attempt + ')');
      const stillFailing = [];
      for (const rowData of toRetry) {
        const result = await runSecureRow(rowData, url);
        if (result) await applySecureResult(result);
        if (isScatterNotFound(result?.message)) stillFailing.push(rowData);
      }
      toRetry = stillFailing;
      attempt++;
    }
  }
}

export function runSecureSingle(row) {
  return new Promise(function(resolve, reject) {
    bgState._secureSingleQueue.push({ row: row, resolve: resolve, reject: reject });
    _drainSecureSingle();
  });
}

function _drainSecureSingle() {
  while (bgState._secureSingleQueue.length > 0 && bgState._secureSingleRunning < SECURE_SINGLE_MAX) {
    var item = bgState._secureSingleQueue.shift();
    bgState._secureSingleRunning++;
    (async () => {
      try {
        await processSingleRowSecure(item.row);
        item.resolve();
      } catch (e) {
        item.reject(e);
      } finally {
        bgState._secureSingleRunning--;
        _drainSecureSingle();
      }
    })();
  }
}

async function processSingleRowSecure(row) {
  const fresh = await withRows(rows => {
    const found = rows.find(r => r.id === row.id);
    return found ? { ...found } : null;
  });
  if (!fresh) return;
  let scatterVal = null;
  if (fresh.payoutDetail && fresh.payoutDetail.length > 0) {
    const parsed = parseInt(fresh.payoutDetail[0], 10);
    if (!isNaN(parsed)) scatterVal = parsed;
  } else if (typeof fresh.payout === 'string' && fresh.payout) {
    const first = fresh.payout.split(' | ')[0];
    const parsed = parseInt(first, 10);
    if (!isNaN(parsed)) scatterVal = parsed;
  }
  if (scatterVal !== null && scatterVal > 5) scatterVal = 5;
  else if (scatterVal === null || ![3, 4, 5].includes(scatterVal)) scatterVal = null;
  if (scatterVal === null || ![3, 4, 5].includes(scatterVal)) {
    await addLog('Immediate:row#' + fresh.id + 'scatter kosong/tidak valid, dilewati');
    return;
  }
  const rowData = { rowNumber: fresh.id, url: 'https://bonussmb.com/tickets', userId: fresh.user, kodeTiket: fresh.kodeTiket, betting: fresh.betting, scatter: String(scatterVal), hasTS: !!fresh.hasTS };
  const claimed = await withRows(allRows => {
    const rowRef = allRows.find(r => r.id === fresh.id);
    if (!rowRef || rowRef.secureStatus) return false;
    rowRef.secureStatus = 'PROCESSING';
    rowRef.updatedAt = Date.now();
    return true;
  });
  if (!claimed) return;
  let tab;
  try {
    tab = await chrome.tabs.create({ url: 'https://bonussmb.com/tickets', active: false });
    await new Promise((res, rej) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); rej(new Error('Tab load timeout')); }, 10000);
      function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); res(); }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
    await new Promise(r => setTimeout(r, 1000));
    const [execResult] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: automateForm, args: [rowData] });
    const result = execResult?.result;
    if (result?.rowNumber && result?.message) {
      await withRows(curRows => {
        const found = curRows.find(r => r.id === result.rowNumber);
        if (found) { found.secureStatus = result.message; found.updatedAt = Date.now(); return true; }
        return false;
      });
    }
  } catch (err) {
    console.error('Immediate error row ' + fresh.id + ':', err);
    await withRows(curRows => { const found = curRows.find(r => r.id === fresh.id); if (found) { found.secureStatus = 'Tab Ticket terganggu silakan coba lagi'; found.updatedAt = Date.now(); } });
  } finally {
    if (tab?.id) { try { chrome.tabs.remove(tab.id); } catch (_) {} }
  }
}

export async function handleSecureResult(rowId, message) {
  try {
    const updated = await withRows(rows => {
      const row = rows.find(r => r.id === rowId);
      if (row) { row.secureStatus = message; row.updatedAt = Date.now(); return true; }
      return false;
    });
    if (updated) await addLog('Secure:row#' + rowId + '\u2192"' + message + '"');
  } catch (err) {
    console.error("handleSecureResult error:", err);
  }
}

function automateForm(data) {
  function wait(ms) { return new Promise(res => setTimeout(res, ms)); }
  function triggerInput(el, value) { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); }
  async function waitForOptions(timeout) { if (timeout === undefined) timeout = 500; const start = Date.now(); while (Date.now() - start < timeout) { const opts = Array.from(document.querySelectorAll('[role="option"], .select2__option')).filter(o => o.offsetParent !== null); if (opts.length > 0) return opts; await wait(5); } return []; }
  async function clickArrowDownAndSelect(ctrl) {
    try {
      if (!ctrl) return false;
      ctrl.click(); await wait(80);
      const inner = ctrl.querySelector('input, [role="combobox"]');
      if (inner) { inner.focus(); inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(120); }
      else { ctrl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(120); }
      const opts = await waitForOptions(500);
      if (opts.length) { opts[0].click(); return true; }
    } catch (e) { console.warn('clickArrowDownAndSelect gagal', e); }
    return false;
  }
  async function fillScatter(scatterValue) {
    if (!scatterValue || !validateScatter(scatterValue)) { console.warn("Scatter value tidak valid:", scatterValue); return false; }
    const xpath = '//*[@id="radix-\u00abr9\u00bb"]/div[2]/form/div[8]/div[2]/div/div';
    const container = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!container) { console.warn("Scatter container tidak ditemukan"); return false; }
    const ctrl = container.querySelector('div[role="combobox"], div > div');
    if (!ctrl) { console.warn("Div Scatter interaktif tidak ditemukan"); return false; }
    ctrl.click(); await wait(50);
    const inner = ctrl.querySelector('input, [role="combobox"]');
    if (inner) { inner.focus(); inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(80); }
    else { ctrl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(80); }
    let opts = []; const t0 = Date.now();
    while (Date.now() - t0 < 1500) { opts = Array.from(document.querySelectorAll('[role="option"]')).filter(function(o) { return o.offsetParent !== null; }); if (opts.length) break; await wait(50); }
    let val = validateScatter(scatterValue);
    if (!val) { console.warn("Scatter value invalid setelah validasi"); return false; }
    const match = opts.find(function(o) { return o.textContent.trim() === String(val); });
    if (match) { match.click(); await wait(100); return true; }
    if (val >= 3 && val <= 5 && opts.length > val - 3) { opts[val - 3].click(); await wait(100); return true; }
    console.warn("Tidak ada option scatter ditemukan untuk", val); await wait(100); return false;
  }
  function isFilled(v) { return v !== undefined && v !== null && v !== ''; }
  function validateScatter(value) { if (!isFilled(value)) return null; const str = value.toString().trim(); if (!/^\d+$/.test(str)) return null; const n = parseInt(str, 10); if (n >= 3) return Math.min(n, 5); return null; }
  async function waitForToastSimple(timeout) { if (timeout === undefined) timeout = 8000; const startTime = Date.now(); let lastContent = ''; while (Date.now() - startTime < timeout) { const section = document.querySelector('section[aria-label="Notifications alt+T"][tabindex="-1"][aria-live="polite"]'); if (section) { const currentContent = section.textContent?.trim(); if (currentContent && currentContent !== lastContent) { lastContent = currentContent; await new Promise(r => setTimeout(r, 100)); const finalContent = section.textContent?.trim(); if (finalContent) return finalContent; } } await new Promise(r => setTimeout(r, 200)); } return null; }
  return (async () => {
    await wait(1500);
    const openBtn = document.evaluate('//*[@id="root"]/div/main/div/div[1]/button', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (openBtn) openBtn.click();
    await wait(800);
    const situsDropdown = document.evaluate('//*[@id="radix-\u00abr9\u00bb"]/div[2]/form/div[1]/div[2]/div', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (situsDropdown) await clickArrowDownAndSelect(situsDropdown);
    await wait(100);
    const tipeDropdown = document.evaluate('//*[@id="radix-\u00abr9\u00bb"]/div[2]/form/div[2]/div[2]/div', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (tipeDropdown) await clickArrowDownAndSelect(tipeDropdown);
    await wait(100);
    const userInput = document.querySelector('input[placeholder="User ID"]');
    const userIdVal = data.hasTS ? data.userId + ' TS' : data.userId;
    if (userInput) { triggerInput(userInput, userIdVal); await wait(100); }
    const kodeInput = document.querySelector('input[placeholder="Kode Tiket"]');
    if (kodeInput) { triggerInput(kodeInput, data.kodeTiket); await wait(100); }
    const bettingInput = document.querySelector('input[type="text"][inputmode="numeric"][placeholder="#######"]');
    if (bettingInput) { triggerInput(bettingInput, data.betting); await wait(100); } else { console.warn("Input bettingan tidak ditemukan"); }
    await wait(150);
    const scatterOk = await fillScatter(data.scatter);
    if (!scatterOk) {
      console.warn("fillScatter gagal, batal submit");
      const failMessage = "Scatter tidak valid atau tidak ditemukan";
      try { chrome.runtime.sendMessage({ type: "SECURE_TOAST_RESULT", row: data.rowNumber, message: failMessage }); } catch (_) {}
      return { rowNumber: data.rowNumber, message: failMessage };
    }
    const saveBtn = document.querySelector('button[data-slot="button"]');
    if (saveBtn) saveBtn.click();
    const toastMessage = await waitForToastSimple();
    const finalMessage = toastMessage || "Toast tidak terdeteksi";
    try { chrome.runtime.sendMessage({ type: "SECURE_TOAST_RESULT", row: data.rowNumber, message: finalMessage }); } catch (_) {}
    return { rowNumber: data.rowNumber, message: finalMessage };
  })();
}
