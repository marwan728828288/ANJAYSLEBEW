(function() {
  var panel = null;
  var toggleBtn = null;
  var switchDot = null;
  var switchEl = null;
  var statusText = null;
  var countText = null;
  var _active = false;
  var _hidden = false;
  var _dirHandle = null;
  var _hideTimer = null;

  function updateUI() {
    if (switchDot) {
      if (_active) {
        switchEl.style.background = 'rgba(74,222,128,0.35)';
        switchEl.style.borderColor = 'rgba(74,222,128,0.4)';
        switchDot.style.left = '13px';
        switchDot.style.background = '#4ade80';
      } else {
        switchEl.style.background = 'rgba(100,116,139,0.15)';
        switchEl.style.borderColor = 'rgba(100,116,139,0.2)';
        switchDot.style.left = '1px';
        switchDot.style.background = '#64748b';
      }
    }
    if (statusText) {
      if (_active) { statusText.textContent = 'Merekam...'; statusText.style.color = '#4ade80'; }
      else if (_dirHandle) { statusText.textContent = 'Siap'; statusText.style.color = '#94a3b8'; }
      else { statusText.textContent = 'Siap'; statusText.style.color = '#94a3b8'; }
    }
    if (toggleBtn) {
      toggleBtn.textContent = _hidden ? '\u25C0' : '\u25B6';
      toggleBtn.style.color = _hidden ? (_active ? '#4ade80' : '#ef4444') : '#4ade80';
    }
    if (panel) panel.style.right = _hidden ? '-195px' : '0';
  }

  function scheduleHide() {
    if (_hideTimer) clearTimeout(_hideTimer);
    _hideTimer = setTimeout(function() {
      if (!_hidden) { _hidden = true; updateUI(); }
    }, 5000);
  }

  function cancelHide() {
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  }

  async function deleteOldFiles() {
    if (!_dirHandle) return;
    try {
      var result = await chrome.storage.local.get('ssFiles');
      var files = result.ssFiles || [];
      var cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;
      var toDelete = [];
      var remaining = [];
      for (var f of files) {
        if (f.timestamp < cutoff) toDelete.push(f);
        else remaining.push(f);
      }
      if (!toDelete.length) return;
      for (var f of toDelete) {
        try {
          var dateDir = await _dirHandle.getDirectoryHandle(f.dateStr);
          var fileName = (f.tab ? f.timeStr + '_' + f.tab : f.timeStr) + '.jpg';
          await dateDir.removeEntry(fileName);
        } catch (e) {}
      }
      await chrome.storage.local.set({ ssFiles: remaining });
    } catch (e) {}
  }

  function openIDB() {
    return new Promise(function(resolve) {
      var req = indexedDB.open('ss-folder-db', 1);
      req.onupgradeneeded = function(e) { e.target.result.createObjectStore('handles'); };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function() { resolve(null); };
    });
  }

  async function saveHandleToIDB(handle) {
    var db = await openIDB();
    if (!db) return;
    var tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'current');
  }

  async function loadHandleFromIDB() {
    var db = await openIDB();
    if (!db) return null;
    return new Promise(function(resolve) {
      var tx = db.transaction('handles', 'readonly');
      var req = tx.objectStore('handles').get('current');
      req.onsuccess = async function() {
        var handle = req.result || null;
        if (handle) {
          try {
            if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
              resolve(null);
              return;
            }
          } catch (e) {
            resolve(null);
            return;
          }
        }
        resolve(handle);
      };
      req.onerror = function() { resolve(null); };
    });
  }

  async function saveFile(base64, dateStr, timeStr, tabName) {
    if (!_dirHandle) return;
    try {
      var safeTab = (tabName || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
      var fileName = timeStr + '_' + safeTab + '.jpg';
      var dateDir = await _dirHandle.getDirectoryHandle(dateStr, { create: true });
      var fileHandle = await dateDir.getFileHandle(fileName, { create: true });
      var writable = await fileHandle.createWritable();
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      await writable.write(bytes);
      await writable.close();
      var result = await chrome.storage.local.get('ssFiles');
      var files = result.ssFiles || [];
      files.push({ dateStr: dateStr, timeStr: timeStr, tab: safeTab, timestamp: Date.now() });
      await chrome.storage.local.set({ ssFiles: files });
      deleteOldFiles();
    } catch (e) {
      _dirHandle = null;
      _active = false;
      safeSend({ type: 'SS_TOGGLE', active: false });
      safeSend({ type: 'SS_USE_FS' });
      var db = await openIDB();
      if (db) {
        var tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete('current');
      }
      updateUI();
    }
  }

  function toggleActive() {
    if (_active) {
      _active = false;
      updateUI();
      safeSend({ type: 'SS_TOGGLE', active: false });
    } else {
      // Aktivasi LANGSUNG — mode download (FS opsional upgrade)
      _active = true;
      updateUI();
      safeSend({ type: 'SS_INIT_DOWNLOAD' });
      safeSend({ type: 'SS_TOGGLE', active: true });

      // Upgrade ke FS mode jika user mau (non-blocking)
      if (!_dirHandle) {
        setTimeout(function() {
          if (_dirHandle) return; // guard: sudah disetup
          window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads', id: 'ss-folder' }).then(function(handle) {
            _dirHandle = handle;
            saveHandleToIDB(handle);
            safeSend({ type: 'SS_USE_FS' });
            updateUI();
          }).catch(function() {});
        }, 800);
      }
    }
  }

  function positionPanel() {
    if (!panel) return;
    var ocrPanel = document.getElementById('lc-panel');
    if (ocrPanel) {
      var r = ocrPanel.getBoundingClientRect();
      panel.style.top = (r.bottom + 6) + 'px';
    }
  }

  function initPanel() {
    if (document.getElementById('lc-ss-panel')) return;

    panel = document.createElement('div');
    panel.id = 'lc-ss-panel';
    panel.style.cssText = 'position:fixed;right:0;width:200px;z-index:999997;transition:right 0.25s ease;background:rgba(15,23,42,0.35);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:8px 12px;box-sizing:border-box;font-family:Arial,sans-serif;border:1px solid rgba(99,102,241,0.08);border-radius:8px 0 0 8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);';

    toggleBtn = document.createElement('div');
    toggleBtn.textContent = '\u25B6';
    toggleBtn.style.cssText = 'position:absolute;left:-18px;top:10px;width:16px;height:24px;background:rgba(15,23,42,0.5);backdrop-filter:blur(6px);border:1px solid rgba(99,102,241,0.08);border-right:none;border-radius:4px 0 0 4px;color:#4ade80;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    toggleBtn.addEventListener('click', function() {
      _hidden = !_hidden;
      updateUI();
      if (!_hidden) scheduleHide();
    });
    panel.appendChild(toggleBtn);

    var contentWrap = document.createElement('div');
    panel.appendChild(contentWrap);

    var title = document.createElement('div');
    title.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
    var titleText = document.createElement('span');
    titleText.textContent = 'SCREENSHOT';
    titleText.style.cssText = 'font-size:9px;font-weight:700;color:#4ade80;text-transform:uppercase;letter-spacing:1px;text-shadow:0 0 12px rgba(74,222,128,0.15);';
    title.appendChild(titleText);

    countText = document.createElement('span');
    countText.style.cssText = 'font-size:11px;font-weight:700;color:#e2e8f0;margin-left:auto;';
    countText.textContent = '0';
    title.appendChild(countText);
    contentWrap.appendChild(title);

    var toggleRow = document.createElement('div');
    toggleRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px;cursor:pointer;user-select:none;';
    toggleRow.addEventListener('click', toggleActive);

    var toggleLabel = document.createElement('span');
    toggleLabel.style.cssText = 'font-size:9px;color:#94a3b8;letter-spacing:.5px;';
    toggleLabel.textContent = 'Auto SS';

    switchEl = document.createElement('div');
    switchEl.style.cssText = 'width:24px;height:12px;border-radius:7px;cursor:pointer;position:relative;transition:background .2s;background:rgba(100,116,139,0.15);border:1px solid rgba(100,116,139,0.2);flex-shrink:0;';
    switchDot = document.createElement('div');
    switchDot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#64748b;position:absolute;top:1px;left:1px;transition:left .2s,background .2s;';
    switchEl.appendChild(switchDot);
    toggleRow.appendChild(toggleLabel);
    toggleRow.appendChild(switchEl);

    statusText = document.createElement('span');
    statusText.style.cssText = 'font-size:8px;color:#64748b;margin-left:auto;';
    statusText.textContent = 'Siap';
    toggleRow.appendChild(statusText);
    contentWrap.appendChild(toggleRow);

    document.body.appendChild(panel);
    panel.addEventListener('mouseenter', cancelHide);
    panel.addEventListener('mouseleave', function() { if (!_hidden) scheduleHide(); });
    positionPanel();
    var _ocrPanel = document.getElementById('lc-panel');
    if (_ocrPanel) {
      try { new ResizeObserver(function() { positionPanel(); }).observe(_ocrPanel); } catch (_) {}
    }
    setInterval(positionPanel, 3000);
    updateUI();
    scheduleHide();
  }

  function isLiveChatPage() {
    return window.location.href.indexOf('my.livechatinc.com/chats/') >= 0 ||
           window.location.href.indexOf('my.livechatinc.com/archives/') >= 0;
  }

  /* ---- Safe sendMessage (tidak throw Extension context invalidated) ---- */
  function safeSend(msg, cb) {
    try {
      chrome.runtime.sendMessage(msg, cb || function(){});
    } catch(e) {
      if (cb) cb(null);
    }
  }

  /* ---- Re-sync status setiap kali tab jadi visible ---- */
  function onVisibilityChange() {
    if (document.hidden) return;
    // Tab jadi aktif lagi — cek status background
    safeSend({ type: 'SS_STATUS' }, function(res) {
      if (!res) return;
      if (res.active && !_active) {
        // Background masih aktif tapi kita ketinggalan — sync
        _active = true;
        updateUI();
      } else if (!res.active && _active) {
        // Background mati — matikan juga UI
        _active = false;
        updateUI();
      }
      if (countText) countText.textContent = res.count;
    });
  }

  function init() {
    // Panel hanya muncul di halaman LiveChat
    if (!isLiveChatPage()) return;

    document.addEventListener('visibilitychange', onVisibilityChange);

    loadHandleFromIDB().then(function(handle) {
      _dirHandle = handle;
      if (handle) {
        safeSend({ type: 'SS_USE_FS' });
        deleteOldFiles();
      }
      safeSend({ type: 'SS_STATUS' }, function(res) {
        if (res) {
          if (res.active && res.useFS && !_dirHandle) {
            _active = false;
            safeSend({ type: 'SS_TOGGLE', active: false });
          } else {
            _active = res.active;
          }
          if (countText) countText.textContent = res.count;
          updateUI();
        }
      });
    });
    initPanel();
    chrome.runtime.onMessage.addListener(function(msg) {
      if (msg.type === 'SS_COUNT') {
        if (countText) countText.textContent = msg.count;
      }
      if (msg.type === 'SS_DATA' && _dirHandle) {
        saveFile(msg.data, msg.date, msg.time, msg.tab);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
