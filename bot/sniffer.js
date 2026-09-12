'use strict';
/* Header Sniffer admin (port dari extension content.js / background.js):
   1) Passive — Network.domain menangkap headers request "/game-oc/" dari tab.
   2) Aktif — inject patch fetch/XMLHttpRequest ke halaman admin (via
   Page.addScriptToEvaluateOnNewDocument) agar headers tersimpan di
   window.__scaterSniff, lalu dibaca balik via evaluate.
   Hasil disimpan per-hostname (bot/lib/tokens.js -> tokens.local.json). */

import { cdpRawAll, listPages } from './cdp.js';
import * as T from './lib/tokens.js';

const PATCH_SOURCE = `(function () {
  if (window.__scaterSniffing) return;
  window.__scaterSniffing = true;
  var KEY = '__scaterSniff';
  function isApi(u) { return /queryTransactionHistoryListForUser|\\/game-oc\\//.test(String(u || '')); }
  function norm(h) {
    if (!h) return {};
    try {
      if (typeof h === 'object' && typeof h.forEach === 'function') { var o = {}; h.forEach(function (v, k) { o[k] = v; }); return o; }
      if (Array.isArray(h)) { var o2 = {}; h.forEach(function (p) { o2[p[0]] = p[1]; }); return o2; }
      if (typeof h === 'object') { var o3 = {}; Object.keys(h).forEach(function (k) { o3[k] = h[k]; }); return o3; }
    } catch (e) {}
    return {};
  }
  function save(rec) {
    try {
      var arr = (window[KEY] || []).slice(-50);
      arr.push(rec);
      window[KEY] = arr;
      try { sessionStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
    } catch (e) {}
  }
  var origFetch = window.fetch;
  if (origFetch) window.fetch = function (input, init) {
    try {
      var u = input && input.url ? input.url : String(input);
      if (isApi(u)) save({ t: Date.now(), url: u, headers: norm((init && init.headers) || {}) });
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };
  var proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (proto) {
    if (proto.open) {
      var origOpen = proto.open;
      proto.open = function (method, url) { try { this.__scaterUrl = url; this.__scaterHdrs = {}; } catch (e) {} return origOpen.apply(this, arguments); };
    }
    if (proto.setRequestHeader) {
      var origSet = proto.setRequestHeader;
      proto.setRequestHeader = function (name, value) {
        try { if (/^(x-agent|x-access-token)/i.test(name)) { this.__scaterHdrs = this.__scaterHdrs || {}; this.__scaterHdrs[name] = value; } } catch (e) {}
        return origSet.apply(this, arguments);
      };
    }
    if (proto.send) {
      var origSend = proto.send;
      proto.send = function (body) {
        try { if (isApi(this.__scaterUrl)) save({ t: Date.now(), url: String(this.__scaterUrl), headers: norm(this.__scaterHdrs || {}), via: 'xhr' }); } catch (e) {}
        return origSend.apply(this, arguments);
      };
    }
  }
})();`;

const SCAN_EXPR = 'JSON.stringify([].concat(window.__scaterSniff || []))';

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function originOf(url) {
  try { return new URL(url).origin; } catch (e) { return ''; }
}

function meaningful(headers) {
  return headers && headers['X-Access-Token'] && String(headers['X-Access-Token']).length >= 10;
}

function saveCapture(url, headers) {
  const host = hostOf(url);
  if (!host || !meaningful(headers)) return null;
  const base = originOf(url);
  T.saveForHost(host, headers, base);
  return host;
}

let installed = [];
let discovering = false;

async function attachHandle(cfg, handle, onSaved) {
  try {
    await handle.send('Network.enable', {});
    await handle.send('Page.enable', {});
    handle.on('Network.requestWillBeSent', (params) => {
      try {
        const req = params && params.request;
        const u = req && req.url;
        if (!u || !(/queryTransactionHistoryListForUser|\/game-oc\//.test(u))) return;
        const h = req.headers || {};
        const host = saveCapture(u, h);
        if (host && onSaved) onSaved(host);
      } catch (e) {}
    });
    try { await handle.addNewDocScript('scater-sniff', PATCH_SOURCE); } catch (e) {}
    try { await handle.eval(PATCH_SOURCE); } catch (e) {}
  } catch (e) { /* tab navigasi/lepas */ }
}

export function targetHosts(cfg) {
  const hosts = new Set([cfg.bonus && cfg.bonus.domain].filter(Boolean));
  (cfg.sites || []).forEach((s) => {
    if (s.historyHost) hosts.add(s.historyHost);
    if (s.apiHost) hosts.add(s.apiHost);
    if (s.host) hosts.add(s.host);
  });
  return hosts;
}

function matchesHost(url, hostSet) {
  const u = url || '';
  for (const h of hostSet) { if (u.includes(h)) return true; }
  return false;
}

/* Pasang sniffer untuk semua tab yang sedang terbuka • hrs dijalankan ulang
   tiap beberapa detik agar tab baru ikut terpantau. */
export async function ensure(cfg, onSaved) {
  const hostSet = targetHosts(cfg);
  let pages;
  try { pages = await listPages(cfg.cdp.port || 9222); }
  catch (e) { return; }
  if (discovering) return;
  discovering = true;
  try {
const fresh = [];
    for (const t of pages) {
      if (!t.url) continue;
      const already = installed.find((i) => i.handle.target.id === t.id && i.alive);
      if (already) { fresh.push(already); continue; }
      try {
        const [handle] = await (async () => {
          const all = await cdpRawAll(cfg.cdp.port || 9222, '');
          return all.filter((h) => h.target.id === t.id);
        })();
        if (!handle) continue;
        const rec = { handle, host: hostOf(t.url), alive: true };
        await attachHandle(cfg, handle, onSaved);
        installed.push(rec);
        fresh.push(rec);
      } catch (e) {}
    }
    installed = fresh;
    await scan(installed, onSaved);
  } finally {
    discovering = false;
  }
}

export async function scan(handles, onSaved) {
  for (const rec of handles || installed) {
    if (!rec.alive) continue;
    try {
      const raw = await rec.handle.eval(SCAN_EXPR);
      const arr = raw ? JSON.parse(raw) : [];
      for (const e of arr) {
        if (!e || !e.url) continue;
        const host = saveCapture(e.url, e.headers || {});
        if (host && onSaved) onSaved(host);
      }
    } catch (e) { rec.alive = false; }
  }
}

export async function closeAll() {
  for (const rec of installed) { try { rec.handle.close(); } catch (e) {} }
  installed = [];
}

export function getPatchSource() { return PATCH_SOURCE; }