'use strict';
/* Klien API admin web bonus — di-port dari extension (klaimMainProcessor).
   - Host history TIDAK lagi bonus.domain: pakai per-site historyHost/apiHost.
   - Request pakai header X-Agent-* yang di-harvest Header Sniffer (tokens.js).
   - Verifikasi: iterasi hari ini + 3 hari mundur (+ wide 60 hari), cari record
     yang sid/kode-tiket cocok & debit > 0 → kembalikan bet/scatter/verdict. */

import * as T from './tokens.js';

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

/* Data sesi admin utk situs klaim; null → token belum tertangkap.
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
  for (const h of cands) {
    if (!h) continue;
    const headers = T.forHost(h, opts || {});
    if (headers) return { host: h, base: T.baseFor(h), headers };
  }
  for (const h of T.allHosts()) {
    const headers = T.forHost(h, opts || {});
    if (headers) return { host: h, base: T.baseFor(h), headers };
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
  return num(r, ['debet', 'debit', 'debetValue', 'debet_value', 'bet', 'amount', 'totalBet', 'total_bet', 'stake']);
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
  return {
    ok: true,
    host: admin.host,
    records,
    matched,
    actualBet: matched ? recBet(matched) : null,
    actualScatter: matched ? recScatter(matched) : null,
    verdict: matched ? recVerdict(matched) : '',
    lastErr
  };
}

/* Submit via API hanya bila endpoint diset di config; default minta mode CDP. */
export async function submitClaim(cfg, claim) {
  throw new Error('SUBMIT_ENDPOINT_NOT_DEFINED: mode non-CDP butuh endpoint API submit di config.');
}

/* Evaluasi kecocokan (cek ganda: bet + scatter, plan item 10-11). */
export function compareClaim(claim, ver) {
  const reasons = [];
  const scatterOk = [3, 4, 5].includes(Number(claim.scatter));
  if (!scatterOk) reasons.push('scatter klaim harus 3/4/5');
  if (ver.actualScatter !== null && Number(claim.scatter) !== Number(ver.actualScatter)) reasons.push('scatter klaim ' + claim.scatter + ' vs aktual ' + ver.actualScatter);
  if (ver.actualBet !== null && Number(claim.betting) !== Number(ver.actualBet)) reasons.push('bet klaim ' + claim.betting + ' vs aktual ' + ver.actualBet);
  if (!ver.matched) reasons.push('tiket ' + claim.kode_tiket + ' tidak ditemukan di history (debit>0)');
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