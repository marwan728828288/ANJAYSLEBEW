import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from '../config.js';

export async function getData(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}

export async function setData(obj, retries = 2) {
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  } catch (err) {
    if (retries <= 0 || !err.message?.includes('QuotaBytes')) throw err;
    var reason = 'Storage: quota penuh, pembersihan otomatis';
    var { logs = [] } = await new Promise(r => chrome.storage.local.get('logs', r));
    logs.push({ time: Date.now(), message: reason });
    if (logs.length > 100) logs.splice(0, logs.length - 100);
    await new Promise(r => chrome.storage.local.set({ logs }, r));
    var keys = await new Promise(r => chrome.storage.local.get(['bgImage', 'decoLeftArr', 'decoRightArr', 'quickNote'], r));
    if (keys.bgImage) await new Promise(r => chrome.storage.local.remove('bgImage', r));
    if ((keys.decoLeftArr?.length || 0) + (keys.decoRightArr?.length || 0) > 0)
      await new Promise(r => chrome.storage.local.remove(['decoLeftArr', 'decoRightArr'], r));
    await setData(obj, retries - 1);
  }
}

/* Tulis rows dengan MERGE: baca state terkini lalu gabungkan baris yang
   ditambahkan konteks lain (panel livechat / popup / dashboard) selama mutator
   berjalan, agar tulis kita TIDAK menghapus baris baru milik mereka
   (bug: data panel livechat hilang tertimpa saat input berturut-turut cepat). */
export async function writeRowsMerged(snapshot) {
  const { rows: fresh = [] } = await getData('rows');
  if (!fresh.length) { await setData({ rows: snapshot }); return; }
  const merged = snapshot.slice();
  for (const r of fresh) {
    const code = r.kodeTiket || r.kode;
    const known = merged.some(s => s.id === r.id || (code && (s.kodeTiket || s.kode) === code));
    if (!known) merged.push(r);
  }
  await setData({ rows: merged });
}

export function withRows(mutator) {
  const run = bgState.rowsLock.then(async () => {
    const { rows = [] } = await getData('rows');
    const result = await mutator(rows);
    await writeRowsMerged(rows);
    return result;
  });
  bgState.rowsLock = run.then(() => {}, () => {});
  return run;
}

export async function addLog(msg) {
  const { logs = [] } = await getData('logs');
  logs.push({ time: Date.now(), message: msg });
  if (logs.length > 100) logs.splice(0, logs.length - 100);
  await setData({ logs });
}

export async function runWithConcurrency(items, limit, worker, staggerMs) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runNext(laneIdx) {
    let first = true;
    while (nextIndex < items.length) {
      const current = nextIndex++;
      if (staggerMs && first) await new Promise(r => setTimeout(r, laneIdx * staggerMs));
      first = false;
      results[current] = await worker(items[current], current);
    }
  }
  const lanes = Array.from({ length: Math.min(limit, items.length) }, (_, i) => runNext(i));
  await Promise.all(lanes);
  return results;
}

export async function detectAdminUrl() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && (tab.url.includes('idrbo2.com') || tab.url.includes('idrbo1.com') || tab.url.includes('idrbo.com'))) {
      try { const u = new URL(tab.url); return u.origin; } catch (_) {}
    }
  }
  return null;
}

export async function getDeviceId() {
  const { deviceId } = await getData('deviceId');
  if (deviceId) return deviceId;
  const newId = crypto.randomUUID();
  await setData({ deviceId: newId });
  return newId;
}

export async function pingDevice() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    const deviceId = await getDeviceId();
    const { userEmail } = await chrome.storage.local.get('userEmail');
    await fetch(SUPABASE_URL + '/rest/v1/devices?on_conflict=device_id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ device_id: deviceId, email: userEmail || '', last_ping: Date.now() })
    });
  } catch (_) {}
}

export const bgState = {
  autoEnabled: true,
  countdown: 60,
  intervalTimer: null,
  isRunning: false,
  queueLastRun: 0,
  manualRunning: false,
  priorityRunning: false,
  manualSafetyTimeout: null,
  manualBusyRows: new Set(),
  manualPending: new Set(),
  invoiceClaimed: new Set(),
  secureIsRunning: false,
  _secureSingleRunning: 0,
  _secureSingleQueue: [],
  rowsLock: Promise.resolve()
};

export const pendingInvoiceTabs = new Map();

export async function restoreAutoState() {
  const saved = await getData('autoEnabled');
  if (saved.autoEnabled !== undefined) bgState.autoEnabled = saved.autoEnabled;
  else await setData({ autoEnabled: bgState.autoEnabled });
}

export async function setAutoEnabled(val) {
  bgState.autoEnabled = !!val;
  await setData({ autoEnabled: bgState.autoEnabled });
}

export const MAX_CONCURRENT = 10;
export const MANUAL_MAX_CONCURRENT = 4;
export const MANUAL_SEARCH_RETRY_MAX = 1;
export const INVOICE_TIMEOUT_MS = 15000;
export const INVOICE_RETRY_TIMEOUT_MS = 20000;
export const INVOICE_RETRY_MAX = 1;
export const MAX_SECURE_CONCURRENT = 4;
export const SECURE_RETRY_SCATTER_MAX = 2;
export const SECURE_SINGLE_MAX = 4;
