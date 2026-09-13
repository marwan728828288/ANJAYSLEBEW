import {
  getData, setData, withRows, addLog, runWithConcurrency,
  bgState
} from './bg-shared.js';

/* ---- LOCK ANTRIAN PERSISTEN (chrome.storage.session) ----
   Service worker MV3 bisa restart KAPAN SAJA (idle, memori, reload). Semua
   state antrian di bgState (isRunning, countdown) HILANG saat restart → run
   baru jalan untuk baris yang SAMA sementara tab /history dari run lama masih
   terbuka (yatim — tidak ada yang menutupnya) = tab /history "double double".
   Lock di storage.session BERTAHAN lintas restart SW (dibersihkan hanya saat
   browser ditutup) → run kedua DITOLAK selama run pertama masih aktif (TTL 5
   menit > durasi batch terpanjang). */
const QUEUE_LOCK_KEY = '_queueLock';
const QUEUE_TABS_KEY = '_queueTabs';
const QUEUE_LOCK_TTL = 5 * 60 * 1000;

function getSession(key) { return new Promise(r => chrome.storage.session.get(key, r)); }
function setSession(obj) { return new Promise(r => chrome.storage.session.set(obj, () => r())); }
function removeSession(key) { return new Promise(r => chrome.storage.session.remove(key, () => r())); }

async function pushQueueTab(tabId) {
  try {
    const { [QUEUE_TABS_KEY]: tabs = [] } = await getSession(QUEUE_TABS_KEY);
    if (tabs.indexOf(tabId) === -1) { tabs.push(tabId); await setSession({ [QUEUE_TABS_KEY]: tabs }); }
  } catch (_) {}
}
async function popQueueTab(tabId) {
  try {
    const { [QUEUE_TABS_KEY]: tabs = [] } = await getSession(QUEUE_TABS_KEY);
    const i = tabs.indexOf(tabId);
    if (i !== -1) { tabs.splice(i, 1); await setSession({ [QUEUE_TABS_KEY]: tabs }); }
  } catch (_) {}
}

/* Tutup tab /history YATIM dari run yang mati (SW restart). Dipanggil setiap
   SW start (initAlarms) — tab lama yang masih terbuka langsung ditutup, jadi
   tidak menumpuk bersama tab run baru (gejala "double double"). */
export async function cleanupOrphanQueueTabs() {
  try {
    const { [QUEUE_TABS_KEY]: tabs = [] } = await getSession(QUEUE_TABS_KEY);
    if (!tabs.length) return;
    for (const id of tabs.slice()) {
      try { await chrome.tabs.remove(id); } catch (_) {}
    }
    await removeSession(QUEUE_TABS_KEY);
  } catch (_) {}
}

export async function startQueueProcess() {
  if (bgState.isRunning) return;
  /* Claim lock persisten: baca → kosong/basi? tulis milik kita, lalu VERIFIKASI
     ulang bahwa lock masih milik kita (pemanggil lain yang menulis belakangan
     → mundur). Tanpa verifikasi ulang, dua pemanggil yang menabrak di celah
     async bisa DOUBLE RUN atau meninggalkan lock macet sampai TTL. */
  const token = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + '-' + Math.floor(Math.random() * 1e9));
  try {
    const { [QUEUE_LOCK_KEY]: lock } = await getSession(QUEUE_LOCK_KEY);
    if (lock && lock.token && Date.now() - (lock.ts || 0) < QUEUE_LOCK_TTL) return;
    await setSession({ [QUEUE_LOCK_KEY]: { ts: Date.now(), token } });
    const { [QUEUE_LOCK_KEY]: after } = await getSession(QUEUE_LOCK_KEY);
    if (!after || after.token !== token) return;
  } catch (_) { return; }
  if (bgState.isRunning) {
    /* Run lain sudah jalan di instance ini → lepaskan lock milik kita (jangan
       macet sampai TTL), lalu mundur — cegah double. */
    try {
      const { [QUEUE_LOCK_KEY]: cur } = await getSession(QUEUE_LOCK_KEY);
      if (cur && cur.token === token) await removeSession(QUEUE_LOCK_KEY);
    } catch (_) {}
    return;
  }
  bgState.isRunning = true;
  bgState.queueLastRun = Date.now();
  try {
    const { rows = [] } = await getData('rows');
    const pending = rows.filter(r => r.kodeTiket && r.autoStatus !== 'APPROVED');
    if (pending.length === 0) return;
    const targetUrl = 'https://bonussmb.com/history';
    /* Dedupe PER KODE TIKET — data sama yang tersimpan 2+ baris (akumulasi
       ribuan baris) cukup dicek SEKALI per siklus: 1 tab /history per data.
       Hasilnya disalin ke SEMUA baris berkode sama di processBatch. */
    const seenCodes = {};
    let data = [];
    for (const r of pending) {
      const v = r.kodeTiket.split('-')[0];
      if (seenCodes[v]) continue;
      seenCodes[v] = true;
      data.push({ row: r.id, value: v });
    }
    await addLog('Auto queue:' + data.length + 'baris antri');
    while (data.length > 0) {
      bgState.queueLastRun = Date.now();
      const batch = data.slice(0, 10);
      await processBatch(batch, targetUrl);
      data = data.slice(batch.length);
    }
  } catch (err) {
    console.error(err);
  } finally {
    /* Lepas lock HANYA kalau masih milik run ini — jangan hapus lock run yang
       lebih baru mengambil alih setelah lock kita basi. */
    try {
      const { [QUEUE_LOCK_KEY]: cur } = await getSession(QUEUE_LOCK_KEY);
      if (cur && cur.token === token) await removeSession(QUEUE_LOCK_KEY);
    } catch (_) {}
    bgState.isRunning = false;
  }
}

export async function monitorQueueHealth() {
  if (!bgState.isRunning) return;
  if (Date.now() - bgState.queueLastRun <= 60000) return;
  /* Tanpa progres > 60 dtk: cek lock — kalau MASIH SEGAR berarti run masih
     hidup (batch sedang jalan, cuma lambat) → JANGAN restart (restart saat
     run hidup = penyebab tab /history dobel). Restart hanya bila lock BASI /
     tidak ada (run lama benar-benar mati). */
  try {
    const { [QUEUE_LOCK_KEY]: lock } = await getSession(QUEUE_LOCK_KEY);
    if (lock && Date.now() - (lock.ts || 0) < QUEUE_LOCK_TTL) return;
  } catch (_) {}
  bgState.isRunning = false;
  startQueueProcess();
}

async function processSingleHistory(item, targetUrl) {
  return new Promise(async resolve => {
    const tab = await chrome.tabs.create({ url: targetUrl, active: false });
    await pushQueueTab(tab.id); /* registri tab — ditutup oleh cleanupOrphanQueueTabs bila SW mati di tengah run */
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(null);
      popQueueTab(tab.id);
      try { chrome.tabs.remove(tab.id); } catch (_) {}
    }, 15000);

    function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.scripting.executeScript({
          target: { tabId },
          func: injectedSingle,
          args: [item]
        }).then(([res]) => {
          resolve(res.result);
          popQueueTab(tab.id);
          chrome.tabs.remove(tab.id);
        }).catch(() => {
          resolve(null);
          popQueueTab(tab.id);
          chrome.tabs.remove(tab.id);
        });
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

export async function processBatch(batch, targetUrl) {
  const results = (await runWithConcurrency(batch, 4, item => processSingleHistory(item, targetUrl))).filter(Boolean);
  let updated = 0;
  await withRows(rows => {
    for (const result of results) {
      const row = rows.find(r => r.id === result.row);
      if (!row) continue;
      const code = (row.kodeTiket || '').split('-')[0];
      /* Salin hasil ke SEMUA baris dengan kode tiket yang SAMA (duplikat data)
         — 1 tab /history per kode (lihat dedupe di startQueueProcess), hasilnya
         berlaku untuk semua baris berkode sama → tidak ada lagi tab dobel untuk
         data yang sama dan baris duplikat ikut ter-approve/reject. */
      for (const dup of rows) {
        if (!dup || !dup.kodeTiket) continue;
        if ((dup.kodeTiket || '').split('-')[0] !== code) continue;
        dup.autoCol9 = result.col9;
        dup.autoStatus = result.status;
        if (result.status) dup.autoCol10 = result.col10 || '';
        dup.updatedAt = Date.now();
        if (dup.betting && dup.payout) dup.manualStatus = '';
      }
      updated++;
    }
  });
  await addLog('Auto:' + updated + 'baris diproses(' + results.length + 'hasil)');
}

async function injectedSingle(item) {
  function xp(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  }

  function setViaPaste(el, value) {
    if (!el) return;
    el.focus();
    navigator.clipboard.writeText(value).catch(() => {});
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt
    }));
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function waitObs(xpath, timeout) {
    if (timeout === undefined) timeout = 10000;
    return new Promise((resolve, reject) => {
      const el = xp(xpath);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const el = xp(xpath);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject('Timeout: ' + xpath); }, timeout);
    });
  }

  async function waitForOptions(timeout) {
    if (timeout === undefined) timeout = 2000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const opts = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] > div, .rc-virtual-list .rc-virtual-list-holder-inner > div')).filter(o => o.offsetParent !== null);
      if (opts.length > 0) return opts;
      await new Promise(r => setTimeout(r, 50));
    }
    return [];
  }

  try {
    const input = await waitObs('//*[@id="root"]/div/main/div/div[3]/div[1]/div[1]/input');
    setViaPaste(input, '');
    await new Promise(r => setTimeout(r, 300));
    setViaPaste(input, item.value);
    await new Promise(r => setTimeout(r, 800));
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 2500));
    const col9El = xp('//*[@id="root"]/div/main/div/div[3]/div[2]/div/table/tbody/tr/td[9]');
    const col10El = xp('//*[@id="root"]/div/main/div/div[3]/div[2]/div/table/tbody/tr/td[10]');
    const col9 = col9El?.innerText.trim() || '';
    const col10 = col10El?.innerText.trim() || '';
    const combined = (col9 + col10).toLowerCase();
    let status = '';
    if (combined.includes('reject')) status = 'REJECTED';
    else if (combined.includes('approve')) status = 'APPROVED';
    return { row: item.row, col9: col9, col10: col10, status: status };
  } catch (_e) {
    return { row: item.row, col9: '', col10: '', status: '' };
  }
}
