import {
  getData, setData, addLog, bgState, pendingInvoiceTabs,
  restoreAutoState, withRows
} from './bg-shared.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_VERSION, CHANGELOG } from '../config.js';

import {
  startQueueProcess, monitorQueueHealth, processBatch, cleanupOrphanQueueTabs
} from './bg-queue.js';

import {
  startManualImmediate, handleBetData
} from './bg-manual.js';

import {
  securePollAutomation, runSecureSingle, handleSecureResult
} from './bg-secure.js';

function initTimer() {
  if (bgState.intervalTimer) clearInterval(bgState.intervalTimer);
  bgState.intervalTimer = setInterval(() => {
    bgState.countdown--;
    if (bgState.countdown <= 0) {
      bgState.countdown = 60;
      if (bgState.autoEnabled) startQueueProcess();
    }
  }, 1000);
}

function createAlarms() {
  chrome.alarms.create('autoPoll', { delayInMinutes: 1, periodInMinutes: 1 });
  chrome.alarms.create('queueWatchdog', { periodInMinutes: 0.1667 });
  chrome.alarms.create('secureUnlockCheck', { periodInMinutes: 1 });
  chrome.alarms.create('dashKeepAlive', { periodInMinutes: 0.25 });
}

async function updateLitePopup() {
  const { liteMode } = await getData('liteMode');
  chrome.action.setPopup({ popup: liteMode ? 'pages/popup.html' : '' });
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SET_LITE_MODE') updateLitePopup();

});

chrome.runtime.onStartup.addListener(() => {
  initTimer();
  createAlarms();
  updateLitePopup();
});

chrome.runtime.onInstalled.addListener((details) => {
  initTimer();
  createAlarms();
  updateLitePopup();
  getData('rows').then(({ rows }) => {
    if (!rows) setData({ rows: [] });
  });
  getData('nextRowId').then(({ nextRowId }) => {
    if (!nextRowId) setData({ nextRowId: 1 });
  });
  chrome.storage.local.get(null, function(all) {
    var toRemove = [];
    for (var key in all) { if (key.indexOf('ocr_') === 0) toRemove.push(key); }
    if (toRemove.length) chrome.storage.local.remove(toRemove);
  });
  if (details.reason === 'update') {
      var changelog = CHANGELOG.find(c => c.version === APP_VERSION);
      if (changelog) {
        getData('postedUpdateVersions').then(({ postedUpdateVersions }) => {
          var posted = postedUpdateVersions || [];
          if (posted.includes(APP_VERSION)) return;
          posted.push(APP_VERSION);
          setData({ postedUpdateVersions: posted });
        });
      }
    }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'secureUnlockCheck') {
    chrome.storage.local.get('secureLock', d => {
      if (d.secureLock && Date.now() - d.secureLock > 120000)
        chrome.storage.local.remove('secureLock');
    });
  }
  if (alarm.name === 'autoPoll') securePollAutomation();
  if (alarm.name === 'queueWatchdog') monitorQueueHealth();
  if (alarm.name === 'dashKeepAlive') {
    // Jaga tab dashboard tetap hidup + worker hangat agar OCR LiveChat tidak cold-start setelah idle
    chrome.tabs.query({ url: chrome.runtime.getURL('pages/dashboard.html') + '*' }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) {
        chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html'), active: false });
        return;
      }
      if (tab.discarded) {
        try { chrome.tabs.reload(tab.id); } catch (_) {}
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'KEEPALIVE_WARM' }).catch(() => {});
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'SEND_TO_SHEET') return;
  const tabId = sender.tab?.id;
  if (!tabId) return;
  handleBetData(msg.payload, tabId);
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'BET_ERROR') return;
  if (!msg.kodeTiket || !msg.error) return;
  const tabId = sender.tab?.id;
  if (tabId) {
    const pending = pendingInvoiceTabs.get(tabId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingInvoiceTabs.delete(tabId);
      pending.resolve();
      try { chrome.tabs.remove(tabId); } catch (_) {}
    }
  }
  const kode = msg.kodeTiket.toString().replace(/\s+/g, '').trim();
  withRows(rows => {
    const row = rows.find(r => {
      const t = (r.kodeTiket || r.kode || '').toString().replace(/\s+/g, '').trim();
      return t === kode || t.startsWith(kode) || t.includes(kode) || kode.startsWith(t.split("-")[0]);
    });
    if (row && !row.payout && row.manualStatus !== msg.error) {
      row.manualStatus = msg.error;
      row.autoCol10 = msg.error;
      row.updatedAt = Date.now();
      addLog('Manual:row#' + row.id + ' → ' + msg.error);
    }
  });
});

chrome.runtime.onMessage.addListener((msg, _sender) => {
  if (msg.type === 'TRIGGER_SECURE') securePollAutomation();
  if (msg.type === 'TRIGGER_AUTO') startQueueProcess();
  if (msg.type === 'TRIGGER_MANUAL') startManualImmediate(msg.priorityIds);
  if (msg.type === 'FORCE_RECHECK') {
    const ids = msg.priorityIds || [];
    for (const id of ids) {
      bgState.manualBusyRows.delete(id);
      for (const [tabId, entry] of pendingInvoiceTabs) {
        if (entry.row === id) {
          clearTimeout(entry.timer);
          pendingInvoiceTabs.delete(tabId);
          entry.resolve();
          try { chrome.tabs.remove(tabId); } catch (_) {}
        }
      }
    }
    startManualImmediate(ids, true);
  }
  if (msg.type === 'TRIGGER_SECURE_ROW') {
    getData('rows').then(({ rows }) => {
      const row = (rows || []).find(r => r.id === msg.rowId);
      if (row) runSecureSingle(row).catch(err => console.error('Secure row err:', err));
    });
  }
  /* TRIGGER_AUTO_ROW dihapus: auto-check history (bonussmb.com/history) hanya
     dijalankan countdown 60 detik (initTimer), bukan langsung saat data masuk. */
});

chrome.runtime.onMessage.addListener((msg, _sender) => {
  if (msg.type !== 'SECURE_TOAST_RESULT') return;
  handleSecureResult(msg.row, msg.message);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (pendingInvoiceTabs.has(tabId)) {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
  } else if (tab.title?.trim() === 'Bet Details') {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  const pending = pendingInvoiceTabs.get(tabId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingInvoiceTabs.delete(tabId);
    pending.resolve();
  }
});

export function initAlarms() {
  createAlarms();
  initTimer();
  /* Tutup tab /history yatim dari run yang mati saat SW restart sebelumnya
     (lock antrian juga memakai storage.session — lihat bg-queue.js). */
  cleanupOrphanQueueTabs();
  /* Catatan: startManualImmediate() sengaja TIDAK dipanggil di sini.
     Saat service worker bangun dari idle (MV3), seluruh module-scope
dijalankan ulang — memanggil startManualImmediate() di initAlarms()
membuat batch penuh berjalan BERSAING dengan handler TRIGGER_MANUAL,
sehingga satu baris kode tiket diproses 2× (tab transaction-record.html
terbuka double). Timer 3 detik (startManualTimer) + TRIGGER_MANUAL
sudah cukup untuk memproses baris pending. */
}

restoreAutoState();
