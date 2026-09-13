'use strict';
/* Simpanan headers/token admin per hostname — hasil Header Sniffer dari tab
   admin yang sudah login (mirip chrome.storage "token"/"historyToken" di
   extension). Ditulis ke bot/tokens.local.json (TIDAK masuk git). */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, 'tokens.local.json');

const HDR_NAMES = ['X-Access-Token', 'X-Agent-Pkid', 'X-Agent-Role', 'X-Agent-Suid', 'X-Agent-User', 'X-Agent-UserId', 'X-Agent-Voice'];
let cache = null;

function read() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    cache = { byHost: {} };
  }
  return cache;
}

function write() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
  } catch (e) { /* abaikan — best effort */ }
}

export function pickHeaders(raw) {
  const out = {};
  for (const k of HDR_NAMES) {
    const v = raw && raw[k];
    if (v !== undefined && v !== null && v !== '') {
      let val = String(v).trim();
      const m = val.match(/^(X-[A-Za-z0-9-]+)[\t\r\n](.*)$/);
      if (m) val = m[2].trim();
      if (val) out[k] = val;
    }
  }
  return out;
}

export function hasToken(h) {
  if (!h) return false;
  return !!(h['X-Access-Token'] && h['X-Access-Token'].length >= 10);
}

/* Kedaluwarsa JWT (exp, ms) tanpa verifikasi signature. null bila tak terbaca. */
export function headerExpiryMs(h) {
  const t = h && h['X-Access-Token'];
  if (!t) return null;
  try {
    const parts = String(t).split('.');
    if (parts.length < 2) return null;
    const pay = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return typeof pay.exp === 'number' ? pay.exp * 1000 : null;
  } catch (e) { return null; }
}

/* Simpan headers yang tertangkap untuk sebuah host (base = origin url api, mis. https://public.zmcyu9ypy.com). */
export function saveForHost(host, headers, base) {
  const h = pickHeaders(headers);
  if (!Object.keys(h).length && !host) return false;
  const st = read();
  st.byHost[host] = Object.assign({}, st.byHost[host], h, { capturedAt: new Date().toISOString() });
  if (base) st.byHost[host].base = base.replace(/\/+$/, '');
  write();
  return true;
}

export function baseFor(host) {
  const st = read();
  return (st.byHost[host] && st.byHost[host].base) || 'https://' + host;
}

/* Headers untuk host tertentu; ageMs=null artinya kembalikan apa adanya. */
export function forHost(host, { requireFresh = false, maxAgeMs = 24 * 3600 * 1000 } = {}) {
  const st = read();
  const rec = st.byHost[host] || {};
  const h = pickHeaders(rec);
  if (!hasToken(h)) return null;
  if (!requireFresh) return h;
  const age = rec.capturedAt ? Date.now() - new Date(rec.capturedAt).getTime() : Infinity;
  if (age > maxAgeMs) return null;
  return h;
}

export function allHosts() {
  return Object.keys(read().byHost || {});
}

export function statusText() {
  const st = read();
  const list = [];
  for (const host of Object.keys(st.byHost || {})) {
    const rec = st.byHost[host];
    const ok = hasToken(pickHeaders(rec));
    list.push({ host, ok, capturedAt: rec.capturedAt || null });
  }
  return list;
}

/* ---- History token (token "?t=" GetBetHistory, TTL 55 mnt, ala extension) ---- */

export const HISTORY_TOKEN_TTL_MS = 55 * 60 * 1000;

export function saveHistoryToken(tk, host) {
  if (!tk || String(tk).length < 10) return false;
  const st = read();
  st.historyToken = String(tk);
  st.historyTokenAt = Date.now();
  if (host) st.historyTokenHost = host;
  write();
  return true;
}

export function getHistoryToken() {
  const st = read();
  if (!st.historyToken || !st.historyTokenAt) return null;
  if (Date.now() - st.historyTokenAt > HISTORY_TOKEN_TTL_MS) return null;
  return st.historyToken;
}

export function clearHistoryToken() {
  const st = read();
  st.historyToken = '';
  st.historyTokenAt = 0;
  write();
}

/* Anchor (klaim terakhir SESUAI) dipakai auto-refresh token history. */
export function saveAnchor(userId, txId, site) {
  if (!userId || !txId) return;
  const st = read();
  st.anchor = { userId: String(userId), txId: String(txId), site: site || '', savedAt: Date.now() };
  write();
}

export function getAnchor() {
  const st = read();
  return st.anchor && st.anchor.userId && st.anchor.txId ? st.anchor : null;
}