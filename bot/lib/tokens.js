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
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  }
  return out;
}

export function hasToken(h) {
  if (!h) return false;
  return !!(h['X-Access-Token'] && h['X-Access-Token'].length >= 10);
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