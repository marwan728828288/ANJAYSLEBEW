'use strict';
/* Klien API admin web bonus — di-port dari extension (klaimMainProcessor).
   - Host history TIDAK lagi bonus.domain: pakai per-site historyHost/apiHost.
   - Request pakai header X-Agent-* yang di-harvest Header Sniffer (tokens.js).
   - Verifikasi: iterasi hari ini + 3 hari mundur (+ wide 60 hari), cari record
     yang sid/kode-tiket cocok & debit > 0 → kembalikan bet/scatter/verdict. */

import * as T from './tokens.js';
import { openPage, closePage, listPages } from '../cdp.js';

const DEFAULT_HISTORY_API = 'https://public-api.zmcyu9ypy.com/web-api/operator-proxy/v1/History/GetBetHistory';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function hdrs(admin) {
  return Object.assign({ 'Content-Type': 'application/json' }, admin || {});
}

export function wibDayStr(d) {
  const now = d ? new Date(d) : new Date(Date.now() + 7 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

export function siteFor(cfg, claim) {
  const want = String(claim.site || '').toLowerCase();
  return (cfg.sites || []).find((s) => String(s.siteId || '').toLowerCase() === want) || null;
}

export function hostFor(cfg, claim) {
  const s = siteFor(cfg, claim);
  return (s && (s.historyHost || s.apiHost || s.host)) || cfg.bonus.domain;
}

/* Kedaluwarsa-minimal: exp JWT masih > 1 menit (atau tak terbaca → jangan blocir). */
function freshEnough(headers) {
  const exp = T.headerExpiryMs(headers || {});
  if (exp === null) return true;
  return exp > Date.now() + 60000;
}

/* Data sesi admin utk situs klaim; null → token belum tertangkap.
   Pass 1 (preferFresh) ambil token yg MASIH SEGAR; pass 2 apa pun yg ada.
   Cari di host site dulu, lalu bonus.domain, lalu host mana pun yg sudah
   tertangkap sniffer (deployment umumnya 1 situs → IP host API langsung dipakai). */
export function adminFor(cfg, claim, opts) {
  const s = siteFor(cfg, claim);
  const cands = [];
  if (s) {
    if (s.historyHost) cands.push(s.historyHost);
    if (s.apiHost) cands.push(s.apiHost);
    if (s.host) cands.push(s.host);
  }
  cands.push(cfg.bonus.domain, '');
  const passes = (opts && opts.preferFresh) ? ['fresh', 'any'] : ['any'];
  for (const pass of passes) {
    for (const h of cands) {
      if (!h) continue;
      const headers = T.forHost(h, opts || {});
      if (!headers) continue;
      if (pass === 'fresh' && !freshEnough(headers)) continue;
      return { host: h, base: T.baseFor(h), headers };
    }
    for (const h of T.allHosts()) {
      const headers = T.forHost(h, opts || {});
      if (!headers) continue;
      if (pass === 'fresh' && !freshEnough(headers)) continue;
      return { host: h, base: T.baseFor(h), headers };
    }
  }
  return null;
}

export async function historyList(base, headers, userId, { pageNo = 1, pageSize = 300, startDate = '', endDate = '', transactionId = '' } = {}) {
  const u = new URL(base.replace(/\/+$/, '') + '/game-oc/ida/transaction/history/queryTransactionHistoryListForUser');
  u.search = new URLSearchParams({ userId, pageNo: String(pageNo), pageSize: String(pageSize), startDate, endDate, transactionId }).toString();
  const r = await fetch(u, { method: 'GET', headers: hdrs(headers) });
  if (!r.ok) throw new Error('history ' + r.status + ' ' + (await r.text()));
  return r.json();
}

/* ---- ekstraksi record toleran (nama field mirip beragam) ---- */

function num(r, keys) {
  for (const k of keys) {
    const v = r[k];
    const n = v === undefined || v === null ? NaN : Number(String(v).replace(/[^\d.-]/g, ''));
    if (!Number.isNaN(n)) return n;
  }
  return NaN;
}

export function recSid(r) {
  return String(r.sid || r.transactionId || r.transaction_id || r.id || r.kodeTiket || r.kode_tiket || '').trim();
}

export function recDebit(r) {
  return num(r, ['debet', 'debit', 'debetValue', 'debet_value', 'bet', 'amount', 'totalBet', 'total_bet', 'stake', 'actualStake']);
}

export function recScatter(r) {
  return num(r, ['scatter', 'scatterCount', 'scatter_count', 'sc', 'imgScatter']);
}

export function recBet(r) {
  return num(r, ['bet', 'totalBet', 'total_bet', 'betAmount', 'bet_amount', 'nominalBet', 'nominal_bet']);
}

export function recVerdict(r) {
  const st = String(r.status || r.state || r.verdict || r.result || r.checkStatus || r.ticketStatus || '').toUpperCase();
  if (/(APPROVE|SUCCESS|SESUAI|BERHASIL|SELESAI|OK\b|CAIR|LUNAS)/.test(st)) return 'APPROVED';
  if (/(REJECT|FAIL|GAGAL|TIDAK|INVALID|DITOLAK|SALAH)/.test(st)) return 'REJECTED';
  return '';
}

function invalidSession(body) {
  const s = JSON.stringify(body || {}).toLowerCase();
  return /token.*(invalid|expired|tidak)|sesi.*(habis|invalid)|unauthorized|401/i.test(s);
}

function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && body.data && Array.isArray(body.data.list)) return body.data.list;
  return [];
}

/* ---- logger + kode game (port lib/parser.js extension) ---- */

export function gameIdOf(r) {
  const raw = String(r.gameName || r.gameId || r.gameID || r.gameCode || '').trim();
  const colon = raw.split(':').pop().trim();
  return colon.match(/\d+/)?.[0] || raw.match(/\d+/)?.[0] || '74';
}

export function debitOf(r) {
  return num(r, ['debet', 'debit', 'debetValue', 'debet_value', 'bet', 'amount', 'totalBet', 'total_bet', 'stake', 'actualStake']);
}

/* ---- parser scatter GetBetHistory (port klaim* background.js extension) ---- */

/* gd.st >= 21 sudah berakhir (bukan bagian bonus) — abaikan saat ambil max. */
function scatterMaxBd(bd) {
  let max = 0;
  for (const item of bd) {
    const gd = item && item.gd || {};
    const st = Number(gd.st);
    const sc = Number(gd.sc);
    if (st >= 21) continue;
    if (isFinite(sc) && sc > max) max = sc;
  }
  return max;
}

/* FreeSpin: spin ke-4 (st=4) yg masuk freespin (nst=21) dengan sc>0;
   bila sc>=5, ikutkan max scatter dari spin berikutnya (4=<st<21). */
function scatterFreeSpin(bd) {
  for (let i = 0; i < bd.length; i++) {
    const gd = bd[i] && bd[i].gd || {};
    const st = Number(gd.st);
    const sc = Number(gd.sc);
    if (!isFinite(sc) || st !== 4) continue;
    if (Number(gd.nst) === 21 && sc > 0) {
      if (sc >= 5) {
        let maxSc = sc;
        for (let j = i + 1; j < bd.length; j++) {
          const g2 = bd[j] && bd[j].gd || {};
          const s2 = Number(g2.st);
          const c2 = Number(g2.sc);
          if (!isFinite(c2)) continue;
          if (s2 >= 4 && s2 < 21 && c2 > maxSc) maxSc = c2;
        }
        return maxSc;
      }
      return sc;
    }
  }
  return null;
}

/* Trigger spin: sebelum masuk bonus (st<4) lalu nst>=4 dan sc>=3. */
function scatterTriggerSpin(bd) {
  for (let i = 0; i < bd.length; i++) {
    const gd = bd[i] && bd[i].gd || {};
    const st = Number(gd.st);
    const nst = Number(gd.nst);
    const sc = Number(gd.sc);
    if (!isFinite(sc)) continue;
    if (st < 4 && nst >= 4 && sc >= 3) return sc;
  }
  return null;
}

function scatterConsensus(bd) {
  const r1 = scatterFreeSpin(bd);
  const r2 = scatterMaxBd(bd);
  const r3 = scatterTriggerSpin(bd);
  const valid = v => v !== null && v >= 3 && v <= 5;
  if (valid(r1) && valid(r2) && valid(r3)) {
    if (r1 === r2 || r1 === r3) return r1;
    if (r2 === r3) return r2;
    return r1;
  }
  if (valid(r1)) return r1;
  if (valid(r2)) return r2;
  if (valid(r3)) return r3;
  return null;
}

function simpleFindScatterRecursive(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 10) return null;
  if (Number(value && value.gd && value.gd.st) === 4 && Number(value && value.gd && value.gd.nst) === 21 && value.gd.sc !== undefined) return value.gd.sc;
  if (Number(value && value.st) === 4 && Number(value && value.nst) === 21 && value.sc !== undefined) return value.sc;
  if (Array.isArray(value)) { for (const item of value) { const f = simpleFindScatterRecursive(item, depth + 1); if (f !== null) return f; } return null; }
  for (const key of Object.keys(value)) { const f = simpleFindScatterRecursive(value[key], depth + 1); if (f !== null) return f; }
  return null;
}

function simpleExtractScatter(pgData) {
  const trig = scatterConsensus(pgData && pgData.dt && pgData.dt.bh && pgData.dt.bh.bd);
  if (trig !== null && trig > 0) return Math.min(trig, 5);
  const bd = pgData && pgData.dt && pgData.dt.bh && pgData.dt.bh.bd;
  if (Array.isArray(bd)) {
    const t = bd.find(item => Number(item && item.gd && item.gd.st) === 4 && Number(item && item.gd && item.gd.nst) === 21);
    if (t && Number(t.gd.sc)) return Math.min(Number(t.gd.sc), 5);
  }
  const found = simpleFindScatterRecursive(pgData);
  const fv = Number(found ?? 0);
  return fv > 0 ? Math.min(fv, 5) : 0;
}

function scatterFallbackExtract(pgData) {
  if (!pgData || typeof pgData !== 'object') return 0;
  const paths = [
    () => { const v = scatterConsensus(pgData && pgData.dt && pgData.dt.bh && pgData.dt.bh.bd); return v !== null && v > 0 ? Math.min(v, 5) : 0; },
    () => { const v = simpleFindScatterRecursive(pgData); return v ? Math.min(parseInt(String(v), 10) || 0, 5) : 0; },
    () => { const s = JSON.stringify(pgData); const m = s.match(/"sc"\s*:\s*([3-9])/); return m ? Math.min(parseInt(m[1], 10), 5) : 0; },
    () => { const s = JSON.stringify(pgData); const m = s.match(/"scatterCount"\s*:\s*([3-9])/i); return m ? Math.min(parseInt(m[1], 10), 5) : 0; }
  ];
  for (const fn of paths) { try { const v = fn(); if (v >= 3 && v <= 5) return v; } catch (e) {} }
  return 0;
}

function invalidSessionMsg(json) {
  if (!json || typeof json !== 'object') return null;
  const msg = String(json.message || json.msg || json.Msg || json.msg_text || json.detail || json.error || json.desc || '').toLowerCase();
  const cd = String(json.cd ?? json.code ?? json.status ?? json.codeId ?? json.code_id ?? '').trim();
  if (/invalid operator session|session invalid|invalid session|session expired|expired session|invalid token|token expired|session tidak valid/.test(msg)) return true;
  return cd === '2001';
}

function invalidSessionText(json) {
  const j = json && typeof json === 'object' ? json : {};
  return String(j.message || j.msg || j.detail || j.error || j.desc || 'Invalid operator session').slice(0, 120);
}

function isSessionInvalidErr(msg) {
  const e = String(msg || '').toLowerCase();
  return /invalid operator session|session invalid|invalid session|session expired|token expired|invalid token|unauthorized|401|403/.test(e);
}

function historyApiFor(cfg, site) {
  if (site && site.historyApi) return site.historyApi;
  return cfg.historyApi || DEFAULT_HISTORY_API;
}

/* Buka keterangan-detail di tab admin (setara refreshHistoryTokenViaTab):
   halaman redirect ke URL history yg memuat "?t=<token>"; poling URL tab
   selama ≤15s, sebagus itu, lalu tutup tab. */
export async function refreshHistoryTokenViaTab(cfg, { userId, sid, gameId, host }) {
  const port = (cfg.cdp && cfg.cdp.port) || 9222;
  const invoice = `${sid}-${sid}-106-0`;
  const hHost = String(host || 'ag-bandar80.idrbo2.com').replace(/^https?:\/\//, '').split('/')[0];
  const url = `https://${hHost}/keterangan-detail.html?playerName=${encodeURIComponent(userId)}&invoice=${encodeURIComponent(invoice)}&gamename=${encodeURIComponent(gameId || '74')}&tablekey=7`;
  let tab = null;
  try {
    tab = await openPage(port, url);
  } catch (e) { return null; }
  const deadline = Date.now() + 15000;
  const tkReg = /[?&]t=([A-Za-z0-9_.~-]{10,})/;
  try {
    while (Date.now() < deadline) {
      let pages;
      try { pages = await listPages(port); } catch (e) { break; }
      const cur = pages.find((p) => p.id === tab.id);
      const m = (cur && cur.url || '').match(tkReg);
      if (m && m[1] && m[1].length >= 10) { T.saveHistoryToken(m[1], hHost); return m[1]; }
      await sleep(300);
    }
  } finally {
    try { await closePage(port, tab.id); } catch (e) {}
  }
  return null;
}

/* Scatter aktual dari GetBetHistory (POST sid+gid ke public-api, token "?t=").
   Bila token history belum ada / sesi mati / data belum siap: refresh lewat
   keterangan-detail lalu coba sekali lagi — alur klaimFetchScatterPg extension. */
async function scatterForTicket(cfg, site, admin, userId, screenId, gameId) {
  let token = T.getHistoryToken();
  if (!token) token = await refreshHistoryTokenViaTab(cfg, { userId, sid: screenId, gameId, host: admin.host });
  if (!token) throw new Error('Token history tidak ditemukan');
  const api = historyApiFor(cfg, site);
  const doFetch = async tk => {
    const r = await fetch(`${api}?t=${encodeURIComponent(tk)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `sid=${encodeURIComponent(screenId)}&gid=${encodeURIComponent(gameId)}`
    });
    if (!r.ok) throw new Error('Gagal akses JSON history: ' + r.status);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('json')) {
      let j = null;
      try { j = await r.clone().json(); } catch (e) {}
      if (j && invalidSessionMsg(j)) throw new Error('INVALID_OPERATOR_SESSION: ' + invalidSessionText(j));
    }
    const d = await r.json();
    const raw = simpleExtractScatter(d);
    if (raw < 3 || raw > 5) {
      const alt = scatterFallbackExtract(d);
      if (alt >= 3 && alt <= 5) return alt;
      throw new Error(`Scatter tidak valid (ditemukan: ${raw}) — data mungkin belum siap`);
    }
    return raw;
  };
  try {
    return await doFetch(token);
  } catch (err) {
    if (isSessionInvalidErr(err.message)) throw err;
    if (/belum siap|scatter tidak valid|token history/i.test(String(err.message || ''))) {
      token = await refreshHistoryTokenViaTab(cfg, { userId, sid: screenId, gameId, host: admin.host });
      if (!token) throw new Error('Token history tidak ditemukan setelah refresh');
      return doFetch(token);
    }
    throw err;
  }
}

/* Verifikasi sesungguhnya: multi-hari + wide; cocokkan kode + debit>0. */
export async function verifyClaimApi(cfg, claim, admin) {
  const { base, headers } = admin;
  const target = String(claim.kode_tiket || '').trim();
  const dates = [wibDayStr()];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(Date.now() + 7 * 3600 * 1000);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const wide = new Date(Date.now() + 7 * 3600 * 1000);
  wide.setDate(wide.getDate() - 60);
  dates.push('wide:' + wide.toISOString().slice(0, 10));

  const seens = new Set();
  const records = [];
  let lastErr = '';
  for (const day of dates) {
    try {
      const body = await historyList(base, headers, claim.user_id, {
        startDate: day.indexOf('wide:') === 0 ? day.slice(5) : day,
        endDate: day.indexOf('wide:') === 0 ? day.slice(5) : day,
        pageNo: 1, pageSize: 300
      });
      if (invalidSession(body)) { lastErr = 'session token invalid/expired'; break; }
      const rows = rowsOf(body);
      for (const r of rows) records.push(r);
    } catch (e) { lastErr = String(e.message || e); }
  }
  let matched = null;
  for (const r of records) {
    const sid = recSid(r);
    if (!sid) continue;
    if ((sid === target || sid.includes(target)) && recDebit(r) > 0) {
      if (!matched || recDebit(r) > recDebit(matched)) matched = r;
    }
  }
  if (!matched) {
    return { ok: true, host: admin.host, records, matched: null, actualBet: null, actualScatter: null, verdict: '', gameMismatch: false, lastErr };
  }

  const gameId = gameIdOf(matched);
  if (gameId !== '65' && gameId !== '74') {
    return { ok: true, host: admin.host, records, matched, actualBet: debitOf(matched) || null, actualScatter: null, verdict: recVerdict(matched), gameMismatch: true, lastErr: 'Bukan Mahjong 1 atau 2 — tolak' };
  }

  const actualBet = debitOf(matched) || null;
  let scatter = null;
  let scatterErr = '';
  try {
    const site = siteFor(cfg, claim);
    scatter = await scatterForTicket(cfg, site, admin, claim.user_id, target.slice(0, 19), gameId);
  } catch (e) {
    scatterErr = String(e.message || e);
    if (isSessionInvalidErr(scatterErr)) { lastErr = 'session token invalid/expired'; }
    else if (/belum siap|scatter tidak valid|token history/i.test(scatterErr)) { lastErr = 'scatter belum siap: ' + scatterErr; }
    else { lastErr = scatterErr; }
  }
  const actualScatter = (scatter !== null && scatter >= 3 && scatter <= 5) ? scatter : null;
  return { ok: true, host: admin.host, records, matched, actualBet, actualScatter, verdict: recVerdict(matched), gameMismatch: false, lastErr: scatterErr || lastErr };
}

/* Submit via API hanya bila endpoint diset di config; default minta mode CDP. */
export async function submitClaim(cfg, claim) {
  throw new Error('SUBMIT_ENDPOINT_NOT_DEFINED: mode non-CDP butuh endpoint API submit di config.');
}

/* Evaluasi kecocokan (cek ganda: bet + scatter, plan item 10-11). */
export function compareClaim(claim, ver) {
  const reasons = [];
  if (ver.gameMismatch) reasons.push(ver.lastErr || 'bukan Mahjong 1/2');
  const scatterOk = [3, 4, 5].includes(Number(claim.scatter));
  if (!scatterOk) reasons.push('scatter klaim harus 3/4/5');
  if (ver.matched) {
    if (ver.actualScatter === null || ver.actualScatter === undefined) reasons.push('scatter tidak terverifikasi (GetBetHistory)');
    else if (Number(claim.scatter) !== Number(ver.actualScatter)) reasons.push('scatter klaim ' + claim.scatter + ' vs aktual ' + ver.actualScatter);
    if (ver.actualBet === null || ver.actualBet === undefined) reasons.push('bet aktual tidak terverifikasi');
    else if (Number(claim.betting) !== Number(ver.actualBet)) reasons.push('bet klaim ' + claim.betting + ' vs aktual ' + ver.actualBet);
  } else {
    reasons.push('tiket ' + claim.kode_tiket + ' tidak ditemukan di history (debit>0)');
  }
  return { match: reasons.length === 0, reasons };
}

/* Status verdict dari list record (opsi polling). Mirip webClaimHistoryVerdict. */
export async function fetchVerdict(cfg, claim, admin) {
  const { base, headers } = admin;
  const body = await historyList(base, headers, claim.user_id, {
    startDate: wibDayStr(), endDate: wibDayStr(), pageNo: 1, pageSize: 300
  });
  const rows = rowsOf(body);
  const target = String(claim.kode_tiket || '').trim();
  for (const r of rows) {
    const sid = recSid(r);
    if (!sid) continue;
    if (sid === target || sid.includes(target)) {
      const v = recVerdict(r);
      if (v) return v;
    }
  }
  return '';
}