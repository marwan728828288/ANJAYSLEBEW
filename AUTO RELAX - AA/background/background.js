import '../modules/bg-messages.js';
import { initAlarms } from '../modules/bg-messages.js';
import { startManualTimer } from '../modules/bg-manual.js';
import { pingDevice } from '../modules/bg-shared.js';
import { initScreenshot } from '../modules/bg-screenshot.js';
import { initOcrBridge } from '../modules/bg-ocr.js';

initAlarms();
startManualTimer();
pingDevice();
initScreenshot();
initOcrBridge();
setInterval(pingDevice, 3600000);

// Buka dashboard otomatis ketika extension di-reload
chrome.storage.session.get('_boot', function(r) {
  if (!r._boot) {
    chrome.storage.session.set({ _boot: true });
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
  }
});
