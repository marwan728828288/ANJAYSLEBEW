'use strict';
/* ============================================================
   scater-lib.js — PORT VERBATIM dari extension
   "AUTO CEK SCATER LIVE (GLOBAL)" v1.5.0 (Downloads/JANGAN DI PAKAI).
   Murni logika CEK: artikel admin-history + scatter GetBetHistory +
   perbandingan COCOK/TIDAK COCOK + hadiah + token TTL.
   Tidak memakai chrome.* — berjalan di worker Vercel (Node).
   ============================================================ */

const WIB_MS = 7 * 3600 * 1000;

const APP = {
  NAME: 'AUTO CEK SCATER LIVE (WEB)',
  VERSION: '1.5.0-web',
  PARALLEL_LIMIT: 20,
  PROCESS_TIMEOUT_MS: 90000,
  BONUS_PROCESS_TIMEOUT_MS: 60000,
  BONUS_PARALLEL_LIMIT: 1,
  HISTORY_TOKEN_TTL_MS: 55 * 60 * 1000,
  SNIFFER_ACTIVE_TTL_MS: 2 * 60 * 60 * 1000,
  MAX_WORKERS: 20
};

const URLS = {
  HISTORY_API: 'https://public-api.zmcyu9ypy.com/web-api/operator-proxy/v1/History/GetBetHistory'
};

const DEFAULT_SCATTER_RULES = [
  { id: 1, minBet: 1600,  maxBet: 2000,    hadiah: { 3: 15000,  4: 30000,  5: 75000  } },
  { id: 2, minBet: 4000,  maxBet: 8000,    hadiah: { 3: 35000,  4: 70000,  5: 140000 } },
  { id: 3, minBet: 10000, maxBet: 18000,   hadiah: { 3: 50000,  4: 100000, 5: 200000 } },
  { id: 4, minBet: 20000, maxBet: 1000000, hadiah: { 3: 100000, 4: 200000, 5: 400000 } }
];

const KLAIM_GAME_NAME_PATTERN = /^(mahjong(\s*\d+|\s*wd)?|slot\s|pg\s|pragmatic)/i;

/* ---------- history token cache (TTL 55 menit ala lib/token.js) ---------- */
let _historyToken = '';
let _historyTokenAt = 0;
function getHistoryToken() {
  if (_historyToken && Date.now() - _historyTokenAt < APP.HISTORY_TOKEN_TTL_MS) return _historyToken;
  return null;
}
function saveHistoryToken(tk) {
  if (!tk || tk.length < 10) return false;
  _historyToken = tk;
  _historyTokenAt = Date.now();
  return true;
}
function forceRefreshHistoryToken() {
  _historyToken = '';
  _historyTokenAt = 0;
}

/* ---------- utils (port lib/utils.js) ---------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function looksLikeToken(v) {
  if (!v || v.length < 20) return false;
  return (/^[A-Za-z0-9_\-]{32,}$/.test(v) || /^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(v) || /^eyJ[A-Za-z0-9_\-]+/.test(v));
}
function extractToken(url) {
  if (!url) return '';
  const s = String(url);
  const m1 = s.match(/redirect\.html[^"'\s]*[?&]t=([A-Za-z0-9_.~-]{10,})/i);
  if (m1) return m1[1];
  const m2 = s.match(/GetBetHistory[^"'\s]*[?&]t=([^&\s"']{10,})/i);
  if (m2) return m2[1];
  const m3 = s.match(/[?&]t=([A-Za-z0-9_.~-]{10,})/i);
  return m3 ? m3[1] : '';
}
function parseAmount(v) {
  if (!v) return 0;
  let s = String(v).replace(/rp/ig, '').replace(/\s+/g, '');
  if (!s) return 0;
  const hasDot = s.includes('.');
  const hasCom = s.includes(',');
  if (hasDot && hasCom) {
    s = s.lastIndexOf('.') > s.lastIndexOf(',') ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (hasCom) {
    s = s.split(',').pop().length === 2 ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasDot) {
    s = s.split('.').pop().length === 2 ? s : s.replace(/\./g, '');
  }
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return isFinite(n) ? n : 0;
}
function extractScatterNum(t) {
  if (!t) return '';
  const m = String(t).match(/(\d+)/);
  return m ? String(Math.min(parseInt(m[1], 10), 5)) : '';
}
function todayStrMs(offsetMs) {
  const d = new Date(Date.now() + offsetMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function domainOf(base) {
  const h = String(base || '').replace(/^https?:\/\//, '').split('/')[0];
  const m = String(h).match(/^(?:[a-z0-9-]+\.)?([a-z0-9-]+\.[a-z]{2,24})$/i);
  return m ? m[1] : '';
}
function historyApiFor(base) {
  const d = domainOf(base);
  if (d) return 'https://public-api.' + d + URLS.HISTORY_API.replace(/^https:\/\/[^/]+/, '');
  return URLS.HISTORY_API;
}

/* ---------- parser (port lib/parser.js verbatim) ---------- */
function klaimExtractRecords(data) {
  let list = null;
  const candidates = [
    data && data.data, data && data.data && data.data.records, data && data.data && data.data.list, data && data.data && data.data.result,
    data && data.result, data && data.records, data && data.list, data && data.transactions,
    data && data.rows, data && data.Data, data && data.data && data.data.Data, data && data.data && data.data.data,
    data && data.response && data.response.data, data && data.result && data.result.records, Array.isArray(data) ? data : null
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) { list = c; break; }
  }
  if (!list) list = klaimDeepFindArray(data);
  return list || [];
}

function klaimDeepFindArray(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
    if (['debet', 'debit', 'bet', 'betting', 'amount', 'stake', 'transactionId', 'sid', 'id'].some(k => k in (obj[0] || {}))) return obj;
  }
  for (const key of Object.keys(obj)) {
    const found = klaimDeepFindArray(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function klaimRecordSid(record) {
  return String((record && (record.transactionId ?? record.transactionID ?? record.transaction_id
    ?? record.keteranganId ?? record.billNo ?? record.orderId ?? record.orderID ?? record.id
    ?? record.sid ?? record.sId ?? record.SID ?? record.kode ?? record.code
    ?? record.reff ?? record.reference ?? record.bonusCode ?? record.txId
    ?? record.trxId ?? record.no ?? record.gameId)) || '').trim();
}

function klaimDebitValue(record) {
  for (const key of ['debet', 'debit', 'bet', 'betting', 'amount', 'stake', 'actualStake']) {
    if (record && (record[key] !== undefined && record[key] !== null && record[key] !== '')) {
      const n = parseAmount(record[key]);
      if (n > 0) return n;
    }
  }
  return 0;
}

function klaimFindDebitRecord(records, sId) {
  const sid = String(sId || '').trim();
  let record = records.find(item => {
    const rs = String(klaimRecordSid(item) || '').trim();
    return (rs === sid || rs.includes(sid)) && klaimDebitValue(item) > 0;
  });
  if (!record) record = records.find(item => klaimDebitValue(item) > 0) || null;
  return record;
}

function klaimGameId(record) {
  const raw = String((record && (record.gameName ?? record.gameId ?? record.gameID ?? record.gameCode)) || '').trim();
  const colon = raw.split(':').pop().trim();
  return colon.match(/\d+/)?.[0] || raw.match(/\d+/)?.[0] || '74';
}

function klaimNormalizeBet(value) {
  return Number(String(value ?? '').replace(/[^\d]/g, '')) || 0;
}

function klaimNormalizeScatter(value) {
  const m = String(value ?? '').match(/\d+/);
  return Math.min(m ? Number(m[0]) : 0, 5);
}

function klaimFormatBet(value) {
  const n = klaimNormalizeBet(value);
  return n ? 'Rp ' + n.toLocaleString('id-ID') : '-';
}

function klaimFormatScatter(value) {
  const n = klaimNormalizeScatter(value);
  return n ? 'x' + n : '-';
}

function klaimCompareResult(expectedBet, actualBet, expectedScatter, actualScatter, errorText = '') {
  if (errorText) return { state: 'mismatch', label: 'GAGAL', detail: errorText, isApprove: false, betMatch: false, scatterMatch: false };
  const betMatch = klaimNormalizeBet(expectedBet) === klaimNormalizeBet(actualBet);
  const scatterMatch = klaimNormalizeScatter(expectedScatter) === klaimNormalizeScatter(actualScatter);
  if (betMatch && scatterMatch) return { state: 'match', label: 'COCOK', detail: 'Bet dan scatter cocok', isApprove: true, betMatch, scatterMatch };
  const misses = [];
  if (!betMatch) misses.push(`Bet beda: input ${klaimFormatBet(expectedBet)} / cek ${klaimFormatBet(actualBet)}`);
  if (!scatterMatch) misses.push(`Scatter beda: input ${klaimFormatScatter(expectedScatter)} / cek ${klaimFormatScatter(actualScatter)}`);
  return { state: 'mismatch', label: 'TIDAK COCOK', detail: misses.join('; '), isApprove: false, betMatch, scatterMatch };
}

function klaimUiRejectReason(cmp) {
  return (cmp && !cmp.isApprove) ? `${cmp.label} — ${cmp.detail}` : '';
}

function klaimClassifyBonusError(errMsg) {
  const e = String(errMsg || '').toLowerCase();
  if (e.includes('data mungkin belum siap') || e.includes('belum siap') || e.includes('belum tersedia')) return 'RETRY';
  if (e.includes('token belum') || e.includes('belum ada') || e.includes('header sniffer') || e.includes('gagal akses admin') || e.includes('cek token')) return 'SESSION_TIMEOUT';
  if (e.includes('token history') || e.includes('gagal akses json') || e.includes('timeout')) return 'RETRY';
  return 'REJECT';
}

function isSessionOrUnknownError(errMsg) {
  const e = String(errMsg || '').toLowerCase();
  return e.includes('session timeout') || e.includes('unknown error') || e.includes('token history') || e.includes('gagal akses json') || e.includes('401') || e.includes('403') || e.includes('unauthorized');
}

/* ---------- scatter GetBetHistory (port background.js 375-536 verbatim) ---------- */
function klaimInvalidSessionMsg(json) {
  if (!json || typeof json !== 'object') return null;
  const msg = String((json && (json.message ?? json.msg ?? json.Msg ?? json.msg_text ?? json.detail ?? json.error ?? json.desc)) || '').toLowerCase();
  const cd = String((json && (json.cd ?? json.code ?? json.status ?? json.codeId ?? json.code_id)) || '').trim();
  if (/invalid operator session|session invalid|invalid session|session expired|expired session|invalid token|token expired|session tidak valid/.test(msg)) return true;
  return cd === '2001';
}

function klaimInvalidSessionText(json) {
  const j = json && typeof json === 'object' ? json : {};
  return String(j.message || j.msg || j.detail || j.error || j.desc || 'Invalid operator session').slice(0, 120);
}

function klaimMaxScatterInBd(pgData) {
  const bd = pgData && pgData.dt && pgData.dt.bh && pgData.dt.bh.bd;
  if (!Array.isArray(bd)) return null;
  let max = 0;
  for (const item of bd) {
    const gd = (item && item.gd) || {};
    const st = Number(gd.st);
    const sc = Number(gd.sc);
    if (st >= 21) continue;
    if (isFinite(sc) && sc > max) max = sc;
  }
  return max;
}

function klaimScatter_FreeSpin(pgData) {
  const bd = pgData && pgData.dt && pgData.dt.bh && pgData.dt.bh.bd;
  if (!Array.isArray(bd)) return null;
  for (let i = 0; i < bd.length; i++) {
    const gd = (bd[i] && bd[i].gd) || {};
    const st = Number(gd.st);
    const sc = Number(gd.sc);
    if (!isFinite(sc) || st !== 4) continue;
    if (Number(gd.nst) === 21 && sc > 0) {
      if (sc >= 5) {
        let maxSc = sc;
        for (let j = i + 1; j < bd.length; j++) {
          const g2 = (bd[j] && bd[j].gd) || {};
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

function klaimScatter_TriggerSpin(pgData) {
  const bd = pgData && pgData.dt && pgData.dt.bh && pgData.dt.bh.bd;
  if (!Array.isArray(bd)) return null;
  for (let i = 0; i < bd.length; i++) {
    const gd = (bd[i] && bd[i].gd) || {};
    const st = Number(gd.st);
    const nst = Number(gd.nst);
    const sc = Number(gd.sc);
    if (!isFinite(sc)) continue;
    if (st < 4 && nst >= 4 && sc >= 3) return sc;
  }
  return null;
}

function klaimScatterConsensus(pgData) {
  const r1 = klaimScatter_FreeSpin(pgData);
  const r2 = klaimMaxScatterInBd(pgData);
  const r3 = klaimScatter_TriggerSpin(pgData);
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

function klaimTriggerScatterInBd(pgData) {
  return klaimScatterConsensus(pgData);
}

function klaimScatterFallbackExtract(pgData) {
  if (!pgData || typeof pgData !== 'object') return 0;
  const paths = [
    () => { const t = klaimTriggerScatterInBd(pgData); return t !== null && t > 0 ? Math.min(t, 5) : 0; },
    () => { const maxSc = klaimMaxScatterInBd(pgData); return maxSc !== null ? Math.min(maxSc, 5) : 0; },
    () => { const v = klaimSimpleFindScatterRecursive(pgData); return v ? Math.min(parseInt(String(v), 10) || 0, 5) : 0; },
    () => { const s = JSON.stringify(pgData); const m = s.match(/"sc"\s*:\s*([3-9])/); return m ? Math.min(parseInt(m[1], 10), 5) : 0; },
    () => { const s = JSON.stringify(pgData); const m = s.match(/"scatterCount"\s*:\s*([3-9])/i); return m ? Math.min(parseInt(m[1], 10), 5) : 0; }
  ];
  for (const fn of paths) { try { const v = fn(); if (v >= 3 && v <= 5) return v; } catch (e) {} }
  return 0;
}

function klaimSimpleExtractScatter(pgData) {
  const trig = klaimTriggerScatterInBd(pgData);
  if (trig !== null && trig > 0) return String(Math.min(trig, 5));
  const maxSc = klaimMaxScatterInBd(pgData);
  if (maxSc !== null && maxSc > 0) return String(Math.min(maxSc, 5));
  const bd = pgData && pgData.dt && pgData.dt.bh && pgData.dt.bh.bd;
  if (Array.isArray(bd)) {
    const scatterTrigger = bd.find(item => Number((item && item.gd && item.gd.st)) === 4 && Number((item && item.gd && item.gd.nst)) === 21);
    if (scatterTrigger) return String(Math.min(Number((scatterTrigger && scatterTrigger.gd && scatterTrigger.gd.sc) ?? 0), 5));
  }
  const found = klaimSimpleFindScatterRecursive(pgData);
  const fv = Number(found ?? 0);
  return String(fv > 0 ? Math.min(fv, 5) : '0');
}

function klaimSimpleFindScatterRecursive(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 10) return null;
  if (Number(value && value.gd && value.gd.st) === 4 && Number(value && value.gd && value.gd.nst) === 21 && value.gd.sc !== undefined) return value.gd.sc;
  if (Number(value && value.st) === 4 && Number(value && value.nst) === 21 && value.sc !== undefined) return value.sc;
  if (Array.isArray(value)) { for (const item of value) { const f = klaimSimpleFindScatterRecursive(item, depth + 1); if (f !== null) return f; } return null; }
  for (const key of Object.keys(value)) { const f = klaimSimpleFindScatterRecursive(value[key], depth + 1); if (f !== null) return f; }
  return null;
}

/* ---------- header builder (background.js 553 / 1296 verbatim) ---------- */
function adminHeaders(st) {
  return {
    'X-Access-Token': st && (st.token || st['X-Access-Token']) || '',
    'X-Agent-Pkid': (st && (st.pkid || st['X-Agent-Pkid'])) || '',
    'X-Agent-Role': (st && (st.role || st['X-Agent-Role'])) || '',
    'X-Agent-Suid': (st && (st.suid || st['X-Agent-Suid'])) || '',
    'X-Agent-User': (st && (st.userAgent || st['X-Agent-User'])) || '',
    'X-Agent-UserId': (st && (st.userid || st['X-Agent-UserId'])) || ''
  };
}

/* ---------- queryTransactionHistoryListForUser (background.js 556-567 verbatim) ---------- */
async function klaimQueryHistoryList(domain, ya, st, mId, pageNo, pageSize, tx, from, to) {
  const u = `https://${domain}/game-oc/ida/transaction/history/queryTransactionHistoryListForUser`
    + `?userId=${encodeURIComponent(mId)}&pageNo=${pageNo}&pageSize=${pageSize || 300}`
    + `&startDate=${encodeURIComponent(from || todayStrMs(0))}&endDate=${encodeURIComponent(to || todayStrMs(0))}`
    + `&transactionId=${encodeURIComponent(tx || '')}`;
  const r = await fetch(u, { method: 'GET', headers: adminHeaders(st) });
  if (!r.ok) throw new Error('history ' + r.status + ' ' + (await r.text().catch(() => '')));
  return r.json();
}

/* ---------- GetBetHistory fetch (background.js 375-536, server variant) ---------- */
async function klaimFetchScatterPgFi(sId, gameId, domain) {
  let token = getHistoryToken();
  if (!token) token = await serverRefreshHistoryToken(sId, gameId, domain);
  if (!token) throw new Error('Token history tidak ditemukan');
  const api = historyApiFor('https://' + domain);
  const doFetch = async tk => {
    const res = await fetch(`${api}?t=${encodeURIComponent(tk)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `sid=${encodeURIComponent(sId)}&gid=${encodeURIComponent(gameId)}`
    });
    if (!res.ok) throw new Error('Gagal akses JSON history: ' + res.status);
    const d = await res.json();
    if (klaimInvalidSessionMsg(d)) throw new Error('INVALID_OPERATOR_SESSION: ' + klaimInvalidSessionText(d));
    const raw = parseInt(klaimSimpleExtractScatter(d), 10) || 0;
    if (raw < 3 || raw > 5) {
      const alt = klaimScatterFallbackExtract(d);
      if (alt >= 3 && alt <= 5) return alt;
      throw new Error('Scatter tidak valid (ditemukan: ' + raw + ') — data mungkin belum siap');
    }
    return raw;
  };
  try {
    return await doFetch(token);
  } catch (err) {
    if (!isSessionOrUnknownError(err.message) && !err.message.includes('Scatter tidak valid')) throw err;
    forceRefreshHistoryToken();
    token = await serverRefreshHistoryToken(sId, gameId, domain);
    if (!token) throw new Error('Token history tidak ditemukan setelah refresh');
    return doFetch(token);
  }
}

/* Server-side token refresh: pakai X-Access-Token admin + keterangan-detail
   bila tersedia; di sini kita coba buka endpoint keterangan lalu ambil t=.
   Karena web-only tanpa browser, refresh default berhenti dengan pesan
   sesi — token history wajib dikirim via panel (Sesi Admin => worker_tokens). */
let _adminSessionForRefresh = null;
function setRefreshSession(st) { _adminSessionForRefresh = st || null; }
async function serverRefreshHistoryToken(sId, gameId, domain) {
  if (_adminSessionForRefresh && (domain || '').includes('idrbo')) {
    const h = String(domain || 'ag-bandar80.idrbo2.com').replace(/^https?:\/\//, '').split('/')[0];
    const invoice = `${sId}-${sId}-106-0`;
    const url = `https://${h}/keterangan-detail.html?playerName=${encodeURIComponent('')}&invoice=${encodeURIComponent(invoice)}&gamename=${encodeURIComponent(gameId || '74')}&tablekey=7`;
    try {
      const r = await fetch(url, { headers: adminHeaders(_adminSessionForRefresh), redirect: 'follow' });
      const t = extractToken(r.url || url);
      if (t && t.length >= 10) { saveHistoryToken(t); return t; }
    } catch (e) {}
  }
  return null;
}

/* ---------- CEK penuh (verbatim flow runQueue/processOneRecord) ---------- */
async function verifyClaim({ base, headers, claim, apiHost }) {
  const st = headers || {};
  const domain = String(base || '').replace(/^https?:\/\//, '').split('/')[0];
  const mId = String((claim && (claim.user_id || claim.user)) || '').trim();
  const sId = String((claim && (claim.kode_tiket || claim.kodeTiket)) || '').trim();
  const expectedBet = claim && (claim.betting || claim.bet);
  const expectedScatter = claim && (claim.scatter || claim.scatterCount);
  const bhApi = apiHost || historyApiFor(base);
  setRefreshSession(st);

  if (!domain || !mId || !sId) return { status: 'GAGAL', label: 'GAGAL', detail: 'payload klaim tidak lengkap' };

  const dates = [];
  for (let i = 0; i < 4; i++) dates.push(todayStrMs(-i * 86400000));
  dates.push('wide:' + todayStrMs(-30));

  let lastErr = '';
  let matched = null;
  let records = [];
  out:
  for (const day of dates) {
    const from = day.indexOf('wide:') === 0 ? day.slice(5) : day;
    let body;
    try {
      body = await klaimQueryHistoryList(domain, bhApi, st, mId, 1, 300, sId, from, from);
      if (klaimInvalidSessionMsg(body)) { lastErr = 'INVALID_OPERATOR_SESSION: ' + klaimInvalidSessionText(body); break; }
    } catch (e) {
      lastErr = String(e.message || e);
      if (isSessionOrUnknownError(lastErr)) break;
      continue;
    }
    const list = klaimExtractRecords(body);
    records = records.concat(list);
    const rec = klaimFindDebitRecord(list, sId);
    if (rec) { matched = rec; break out; }
  }

  if (!matched) {
    const cmp = klaimCompareResult(expectedBet, 0, expectedScatter, 0, lastErr || 'userId berbeda benar sedikit bos');
    return { status: cmp.state === 'match' ? 'SESUAI' : cmp.label, label: cmp.label, detail: cmp.detail, match: cmp.isApprove, actualBet: null, actualScatter: null, betMatch: false, scatterMatch: false, describe: cmp, records };
  }

  const gameId = klaimGameId(matched);
  if (gameId !== '65' && gameId !== '74') {
    const cmp = klaimCompareResult(expectedBet, klaimDebitValue(matched), expectedScatter, 0, 'Bukan Mahjong 1 atau 2 — tolak');
    return { status: cmp.label, label: cmp.label, detail: cmp.detail, match: false, actualBet: klaimDebitValue(matched) || null, actualScatter: null, betMatch: false, scatterMatch: false, gameMismatch: true, describe: cmp, records };
  }

  const actualBet = klaimDebitValue(matched) || null;
  if (!actualBet) {
    const cmp = klaimCompareResult(expectedBet, actualBet, expectedScatter, 0, 'Nilai debet invalid');
    return { status: cmp.label, label: cmp.label, detail: cmp.detail, match: false, actualBet, actualScatter: null, describe: cmp, records };
  }

  let actualScatter = null;
  let scatterErr = '';
  try {
    actualScatter = await klaimFetchScatterPgFi(sId, gameId, domain);
  } catch (e) {
    scatterErr = String(e.message || e);
    const cls = klaimClassifyBonusError(scatterErr);
    if (cls === 'SESSION_TIMEOUT' || isSessionOrUnknownError(scatterErr)) {
      return { status: 'SESSION_TIMEOUT', label: 'INVALID_SESSION', detail: scatterErr.slice(0, 300), match: null, actualBet, actualScatter: null, sessionInvalid: true, describe: null, records };
    }
  }

  const cmp = klaimCompareResult(expectedBet, actualBet, expectedScatter, actualScatter, scatterErr || '');
  return {
    status: cmp.state === 'match' ? 'SESUAI' : cmp.label,
    label: cmp.label,
    detail: cmp.detail,
    match: cmp.isApprove,
    actualBet,
    actualScatter,
    betMatch: cmp.betMatch,
    scatterMatch: cmp.scatterMatch,
    gameMismatch: false,
    describe: cmp,
    records
  };
}

/* ---------- hadiah rules ---------- */
function calcHadiah(bet, scatter) {
  const b = klaimNormalizeBet(bet);
  const s = klaimNormalizeScatter(scatter);
  if (!b || !s) return 0;
  const rule = DEFAULT_SCATTER_RULES.find(r => b >= r.minBet && b <= r.maxBet);
  return rule ? (rule.hadiah[s] || 0) : 0;
}

module.exports = {
  APP, URLS, DEFAULT_SCATTER_RULES, KLAIM_GAME_NAME_PATTERN,
  sleep, looksLikeToken, extractToken, parseAmount, extractScatterNum, todayStrMs,
  domainOf, historyApiFor,
  klaimExtractRecords, klaimRecordSid, klaimDebitValue, klaimFindDebitRecord,
  klaimGameId, klaimNormalizeBet, klaimNormalizeScatter, klaimCompareResult,
  klaimClassifyBonusError, isSessionOrUnknownError,
  klaimInvalidSessionMsg, klaimInvalidSessionText,
  klaimSimpleExtractScatter, klaimScatterFallbackExtract, klaimScatterConsensus,
  adminHeaders, klaimQueryHistoryList, klaimFetchScatterPgFi,
  getHistoryToken, saveHistoryToken, setRefreshSession,
  verifyClaim, calcHadiah
};