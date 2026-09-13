var captureCount = 0;
var isActive = false;
var captureInterval = null;
var useFS = false;

function getDateStr(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function getTimeStr(d) {
  return String(d.getHours()).padStart(2, '0') + '-' +
    String(d.getMinutes()).padStart(2, '0') + '-' +
    String(d.getSeconds()).padStart(2, '0');
}

function notifyCount() {
  try {
    chrome.tabs.query({ currentWindow: true }, function(tabs) {
      for (var i = 0; i < tabs.length; i++) {
        chrome.tabs.sendMessage(tabs[i].id, { type: 'SS_COUNT', count: captureCount }).catch(function() {});
      }
    });
  } catch (_) {}
}

function doCapture() {
  chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 }, function(dataUrl) {
    if (chrome.runtime.lastError || !dataUrl) return;
    var now = new Date();
    var ds = getDateStr(now);
    var ts = getTimeStr(now);

    if (useFS) {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (!tabs || !tabs.length) return;
        var safeTitle = (tabs[0].title || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SS_DATA', data: dataUrl.split(',')[1], date: ds, time: ts, tab: safeTitle })
          .then(function() { captureCount++; notifyCount(); })
          .catch(function() {});
      });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        var safeTitle = tabs && tabs.length ? (tabs[0].title || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) : 'untitled';
        var path = 'logs ss/' + ds + '/' + ts + '_' + safeTitle + '.jpg';
        chrome.downloads.download({ url: dataUrl, filename: path, saveAs: false, conflictAction: 'uniquify' }, function(id) {
          if (chrome.runtime.lastError || !id) return;
          var handler = function(delta) {
            if (delta.id === id && delta.state && delta.state.current === 'complete') {
              chrome.downloads.onChanged.removeListener(handler);
              chrome.downloads.erase({ id: id }, function() {});
              captureCount++;
              notifyCount();
            }
          };
          chrome.downloads.onChanged.addListener(handler);
          setTimeout(function() { chrome.downloads.onChanged.removeListener(handler); }, 10000);
        });
      });
    }
  });
}

function startCapture() {
  if (captureInterval) return;
  doCapture();
  captureInterval = setInterval(doCapture, 5000);
}

function stopCapture() {
  if (captureInterval) { clearInterval(captureInterval); captureInterval = null; }
}

/* ---- Simpan/restore state ke storage biar survive SW sleep ---- */
function saveState() {
  try {
    if (isActive) {
      chrome.storage.local.set({ _ssState: { active: isActive, count: captureCount, useFS: useFS } });
    } else {
      chrome.storage.local.remove('_ssState');
    }
  } catch(e) {}
}

function restoreState(cb) {
  try {
    chrome.storage.local.get('_ssState', function(r) {
      var s = r._ssState;
      if (s) {
        isActive = s.active || false;
        captureCount = s.count || 0;
        useFS = s.useFS || false;
        if (isActive) startCapture();
      }
      if (cb) cb();
    });
  } catch(e) { if (cb) cb(); }
}

/* ---- Restore state saat SW wakeup ---- */
restoreState();

export function initScreenshot() {
  /* Restore juga dari initScreenshot call (dipanggil dari background.js) */
  restoreState();

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'SS_TOGGLE') {
      isActive = !!msg.active;
      if (isActive) startCapture();
      else { stopCapture(); captureCount = 0; }
      saveState();
      sendResponse({ ok: true });
    }
    if (msg.type === 'SS_STATUS') {
      sendResponse({ active: isActive, count: captureCount, useFS: useFS });
    }
    if (msg.type === 'SS_USE_FS') {
      useFS = true;
      saveState();
      sendResponse({ ok: true });
    }
    if (msg.type === 'SS_INIT_DOWNLOAD') {
      chrome.downloads.download({
        url: 'data:text/plain;base64,',
        filename: 'logs ss/_ready_' + Date.now() + '.txt',
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(id) {
        if (!id) return;
        setTimeout(function() {
          chrome.downloads.erase({ id: id }, function() {});
        }, 100);
      });
    }
    if (msg.type === 'SS_OPEN_FOLDER') {
      var d = new Date();
      var p = 'logs ss/' + getDateStr(d);
      chrome.downloads.download({
        url: 'data:text/plain;base64,',
        filename: p + '/_open_me.txt',
        saveAs: false,
        conflictAction: 'uniquify'
      }, function(id) {
        if (!id) return;
        var handler = function(delta) {
          if (delta.id === id && delta.state && delta.state.current === 'complete') {
            chrome.downloads.onChanged.removeListener(handler);
            chrome.downloads.show(id);
            setTimeout(function() { chrome.downloads.erase({ id: id }, function() {}); }, 100);
          }
        };
        chrome.downloads.onChanged.addListener(handler);
        setTimeout(function() { chrome.downloads.onChanged.removeListener(handler); }, 5000);
      });
    }
  });
}
