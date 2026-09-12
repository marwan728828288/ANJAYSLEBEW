'use strict';
/* JS string yang di-inject ke tab bonus via CDP Runtime.evaluate.
   Port dari fill_claim_page.js — dipanggil 1x untuk setup, lalu window.__fillClaim(data).
   Dibuat tangguh: jika XPath template (radix-«r9») tidak ketemu, jatuh ke
   selector generik [role="dialog"] + combobox. */

export const FILL_SETUP = `
(function () {
  if (window.__fillClaimReady) return true;
  window.__fillClaimReady = true;

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function triggerInput(el, value) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
  function qa(sel, ctx) { try { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); } catch (e) { return []; } }

  async function waitForOptions(timeout) {
    if (timeout === undefined) timeout = 700;
    var start = Date.now();
    while (Date.now() - start < timeout) {
      var opts = qa('[role="option"], .select2__option').filter(function(o){ return o.offsetParent !== null; });
      if (opts.length > 0) return opts;
      await wait(5);
    }
    return [];
  }
  function findDialogRoot() {
    var byId = document.querySelector('#radix-\\u00ABr9\\u00BB');
    if (byId) return byId;
    var d = qa('[role="dialog"]');
    return d.length ? d[d.length - 1] : null;
  }
  async function clickSelectAndPick(ctrl, prefer) {
    try {
      if (!ctrl) return false;
      ctrl.click(); await wait(90);
      var inner = ctrl.querySelector('input, [role="combobox"]');
      if (inner) { inner.focus(); inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); }
      else { ctrl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); }
      await wait(140);
      var opts = await waitForOptions(800);
      if (!opts.length) return false;
      var target = opts[0];
      if (prefer) {
        for (var i = 0; i < opts.length; i++) {
          var t = (opts[i].textContent || '').trim().toLowerCase();
          if (t.indexOf(String(prefer).toLowerCase()) >= 0) { target = opts[i]; break; }
        }
      }
      target.click(); await wait(120);
      return true;
    } catch (e) {}
    return false;
  }
  function isFilled(v) { return v !== undefined && v !== null && v !== ''; }
  function validateScatter(value) {
    if (!isFilled(value)) return null;
    var str = value.toString().trim();
    if (!/^\\\\d+$/.test(str)) return null;
    var n = parseInt(str, 10);
    if (n >= 3) return Math.min(n, 5);
    return null;
  }
  async function fillScatter(scatterValue, dialog) {
    if (!scatterValue || !validateScatter(scatterValue)) return false;
    var container = null;
    try {
      var byId = dialog || document.querySelector('#radix-\\u00ABr9\\u00BB');
      if (byId) container = document.evaluate('//*[@id="radix-\\u00ABr9\\u00BB"]/div[2]/form/div[8]/div[2]/div/div', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch (e) {}
    if (!container && dialog) {
      var combos = qa('[role="combobox"]', dialog);
      if (combos.length >= 3) container = combos[combos.length - 1].closest('div');
    }
    var ctrl = container && (container.querySelector('div[role="combobox"], div > div'));
    if (!ctrl) return false;
    ctrl.click(); await wait(70);
    var inner = ctrl.querySelector('input, [role="combobox"]');
    if (inner) { inner.focus(); inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); }
    else { ctrl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); }
    await wait(120);
    var opts = []; var t0 = Date.now();
    while (Date.now() - t0 < 1700) {
      opts = qa('[role="option"]').filter(function(o){ return o.offsetParent !== null; });
      if (opts.length) break;
      await wait(50);
    }
    var val = validateScatter(scatterValue);
    if (!val) return false;
    var match = opts.find(function(o){ return o.textContent.trim() === String(val); });
    if (match) { match.click(); await wait(120); return true; }
    if (val >= 3 && val <= 5 && opts.length > val - 3) { opts[val - 3].click(); await wait(120); return true; }
    return false;
  }
  async function waitForToast(timeout) {
    if (timeout === undefined) timeout = 12000;
    var startTime = Date.now(); var lastContent = '';
    while (Date.now() - startTime < timeout) {
      var section = document.querySelector('section[aria-label="Notifications alt+T"][tabindex="-1"][aria-live="polite"]');
      if (section) {
        var currentContent = (section.textContent || '').trim();
        if (currentContent && currentContent !== lastContent) {
          lastContent = currentContent;
          await new Promise(function(r){ setTimeout(r, 100); });
          var finalContent = (section.textContent || '').trim();
          if (finalContent) return finalContent;
        }
      }
      await new Promise(function(r){ setTimeout(r, 200); });
    }
    return null;
  }
  function isLikelySuccess(msg) {
    var m = String(msg || '').toLowerCase();
    return !m.includes('gagal') && !m.includes('error') && !m.includes('tidak valid') && !m.includes('tidak ditemukan') && (m.includes('berhasil') || m.includes('sukses') || m.includes('tersimpan') || m.includes('masuk') || m.includes('klaim'));
  }
  function findOpenBtn() {
    var btn = document.evaluate('//*[@id="root"]/div/main/div/div[1]/button', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (btn) return btn;
    return qa('button').find(function(b){ return /tambah|klaim|new|create/i.test(b.textContent || ''); }) || null;
  }

  window.__fillClaim = async function (data) {
    try {
      await wait(1200);
      var userIdVal = data.hasTS ? data.userId + ' TS' : data.userId;
      var openBtn = findOpenBtn();
      var t0open = Date.now();
      while (!openBtn && Date.now() - t0open < 10000) { await wait(500); openBtn = findOpenBtn(); }
      if (!openBtn) return { ok: false, message: 'Tombol tambah klaim tidak ditemukan' };
      openBtn.click();
      await wait(1200);
      var dialog = findDialogRoot();
      if (!dialog) return { ok: false, message: 'Dialog form tidak muncul' };
      var combos = qa('[role="combobox"]', dialog);
      var situsPopup = combos[0] || null;
      var tipePopup = combos[1] || null;
      if (situsPopup) await clickSelectAndPick(situsPopup, data.site);
      await wait(250);
      if (tipePopup) await clickSelectAndPick(tipePopup);
      await wait(350);
      var combos2 = qa('[role="combobox"]', dialog);
      if (combos2.length >= 3 && combos2[2] && combos2[2] !== situsPopup && combos2[2] !== tipePopup) {
        await clickSelectAndPick(combos2[2]);
        await wait(250);
      }
      var userInput = document.querySelector('input[placeholder="User ID"]');
      if (userInput) { triggerInput(userInput, userIdVal); await wait(100); }
      var kodeInput = document.querySelector('input[placeholder="Kode Tiket"]');
      if (kodeInput) { triggerInput(kodeInput, data.kodeTiket); await wait(100); }
      if (data.link) {
        var linkInput = document.querySelector('input[placeholder*="Link"]');
        if (linkInput) { triggerInput(linkInput, data.link); await wait(100); }
      }
      var saveBtn = dialog.querySelector('button[data-slot="button"]') || qa('button', dialog).find(function (b) { return /simpan|save|submit/i.test(b.textContent || ''); });
      if (!saveBtn) return { ok: false, message: 'Tombol Simpan Data tidak ditemukan' };
      saveBtn.click();
      var toastMessage = await waitForToast();
      var finalMessage = toastMessage || 'Toast tidak terdeteksi';
      return { ok: isLikelySuccess(finalMessage), message: finalMessage };
    } catch (errFill) {
      return { ok: false, message: 'Script form gagal: ' + String((errFill && errFill.message) || errFill) };
    }
  };
  window.__bonusApi = async function (path, q) {
    try {
      var qs = new URLSearchParams((q || {})).toString();
      var res = await fetch(path + (qs ? '?' + qs : ''), { method: 'GET', credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
      var body = null;
      try { body = await res.json(); } catch (e) {}
      return { ok: res.ok, status: res.status, data: body };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: String((e && e.message) || e) };
    }
  };
  return true;
})();
`;