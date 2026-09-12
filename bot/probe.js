'use strict';
/* Live-test persiapan CDP: cek DOM halaman bonus sekali, tanpa menekan apa pun.
   Jalankan: node bot/probe.js
   Urutan: connect tab -> setup injeksi -> detect() -> report form + tombol-tombol. */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cdpConnect } from './cdp.js';
import { FILL_SETUP } from './inject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = (await import(pathToFileURL(path.join(__dirname, 'config.local.js')).href)).default;

const conn = await cdpConnect(cfg.cdp?.port || 9222, cfg.cdp?.urlMatch || '');
console.log('Tab: ' + conn.tabUrl);

await conn.evaluate(FILL_SETUP);

const report = await conn.evaluate(`(() => {
  const qa = (s, c) => Array.prototype.slice.call((c || document).querySelectorAll(s));
  return {
    openBtn: !!document.evaluate('//*[@id="root"]/div/main/div/div[1]/button', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue,
    fallbackBtn: !!qa('button').find(b => /tambah|klaim|new|create/i.test(b.textContent || ''))?.textContent?.slice(0, 40),
    dialogs: qa('[role="dialog"]').length,
    comboboxes: qa('[role="combobox"]').length,
    userInput: (document.querySelector('input[placeholder="User ID"]') || {}).placeholder || null,
    kodeInput: (document.querySelector('input[placeholder="Kode Tiket"]') || {}).placeholder || null,
    bettingInput: (document.querySelector('input[type="text"][inputmode="numeric"][placeholder="#######"]') || {}).placeholder || null,
    saveBtn: !!document.querySelector('button[data-slot="button"]'),
    toast: !!document.querySelector('section[aria-label="Notifications alt+T"][tabindex="-1"][aria-live="polite"]'),
    buttons: qa('button').slice(0, 8).map(b => (b.textContent || '').trim().slice(0, 30))
  };
})()`);

console.log('Deteksi DOM:');
console.log(JSON.stringify(report, null, 2));
conn.close();