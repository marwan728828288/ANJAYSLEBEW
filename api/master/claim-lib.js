'use strict';
/* ============================================================
   BANDAR80 — api/master/claim-lib.js
   Logika CEK scatter + approve/reject di server (Vercel), TANPA
   extension/daemon/CDP. Port dari bot/lib/bonus.js + extension
   klaim* (pure HTTP fetch).

   Prinsip token: header admin X-Access-Token (di-paste di panel)
   dipakai sekaligus untuk:
     - historyList  (GET .../game-oc/ida/transaction/history/...)
     - GetBetHistory (?t=<X-Access-Token>) — sama seperti URL history
       di extension (&t=freshToken).
   ============================================================ */

const WIB_MS = 7 * 3600 * 1000;
const DEFAULT_HISTORY_API = 'https://public-api.zmcyu9ypy.com/web-api/operator-proxy/v1/History/GetBetHistory';
const HISTORY_API_PATH = '/web-api/operator-proxy/v1/History/GetBetHistory';

/* Domain publik dari base (mis. bandar80.idrbo2.com → idrbo2.com) */
function domainOf(base) {
  const h = String(base || '').replace(/^https?:\/\//, '').split('/')[0];
  const m = String(h).match(/^(?:[a-z0-9-]+\.)?([a-z0-9-]+\.[a-z]{2,24})$/i);
  return m ? m[1] : '';
}
/* GetBetHistory milik SITUS itu (bukan hardcoded zmcyu9ypy).
   Sama dgn logika extension: public-api.<domain> + path operator-proxy. */
function historyApiFor(base) {
  const d = domainOf(base);
  if (d) return 'https://public-api.' + d + HISTORY_API_PATH;
  return DEFAULT_HISTORY_API;
}

function jwtExpMs(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const pay = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return typeof pay.exp === 'number' ? pay.exp * 1000 : null;
  } catch (e) { return null; }
}

/* Base host dari header admin (base url api, mis. https://bandar80.idrbo2.com). */
function baseUrlFor(row) {
  const base = row && row.base ? String(row.base).replace(/\/+$/, '') : '';
  if (base) return base;
  if (row && row.host) return 'https://' + row.host.replace(/^https?:\/\//, '');
  return '';
}

function wibDayStr(offsetDays) {
  const now = new Date(Date.now() + WIB_MS);
  if (offsetDays) now.setDate(now.getDate() - offsetDays);
  return now.toISOString().slice(0, 10);
}

function hdrs(headers) {
  return Object.assign({ 'Content-Type': 'application/json' }, headers || {});
}

/* GET history user dari admin (basedata row worker_tokens yg punya headers). */
async function historyList(base, headers, userId, { pageNo = 1, pageSize = 300, startDate = '', endDate = '', transactionId = '' } = {}) {
  const u = new URL(base + '/game-oc/ida/transaction/history/queryTransactionHistoryListForUser');
  u.search = new URLSearchParams({ userId, pageNo: String(pageNo), pageSize: String(pageSize), startDate, endDate, transactionId }).toString();
  const r = await fetch(u, { method: 'GET', headers: hdrs(headers) });
  if (!r.ok) throw new Error('history ' + r.status + ' ' + (await r.text()));
  return r.json();
}

/* ---- ekstraksi record toleran ---- */
function num(r, keys) {
  for (const k of keys) {
    const v = r[k];
    const n = v === undefined || v === null ? NaN : Number(String(v).replace(/[^\d.-]/g, ''));
    if (!Number.isNaN(n)) return n;
  }
  return NaN;
}
function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && body.data && Array.isArray(body.data.list)) return body.data.list;
  return [];
}
function recSid(r) {
  return String(r.sid || r.transactionId || r.transaction_id || r.id || r.kodeTiket || r.kode_tiket || '').trim();
}
function recDebit(r) {
  return num(r, ['debet', 'debit', 'debetValue', 'debet_value', 'bet', 'amount', 'totalBet', 'total_bet', 'stake', 'actualStake']);
}
function gameIdOf(r) {
  const raw = String(r.gameName || r.gameId || r.gameID || r.gameCode || '').trim();
  const colon = raw.split(':').pop().trim();
  return colon.match(/\d+/)?.[0] || raw.match(/\d+/)?.[0] || '74';
}
function recVerdict(r) {
  const st = String(r.status || r.state || r.verdict || r.result || r.checkStatus || r.ticketStatus || '').toUpperCase();
  if (/(APPROVE|SUCCESS|SESUAI|BERHASIL|SELESAI|OK\b|CAIR|LUNAS)/.test(st)) return 'APPROVED';
  if (/(REJECT|FAIL|GAGAL|TIDAK|INVALID|DITOLAK|SALAH)/.test(st)) return 'REJECTED';
  return '';
}
function invalidSession(body) {
  const s = JSON.stringify(body || {}).toLowerCase();
  return /token.*(invalid|expired|tidak)|token has expired|sesi.*(habis|invalid)|unauthorized|401/.test(s);
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
  return /invalid operator session|session invalid|invalid session|session expired|expired session|token expired|token has expired|has expired|invalid token|unauthorized|401|403/.test(e);
}

/* ---- parser scatter GetBetHistory (bd = dt.bh.bd) ---- */
function scatterMaxBd(bd) {
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
function scatterFreeSpin(bd) {
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
function scatterTriggerSpin(bd) {
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

/* Scatter aktual dari GetBetHistory: t = X-Access-Token admin (sama dgn
   URL history extension). Tanpa refresh tab — cloud-first.
   apiHost = base yg punya token → otomatis public-api.<domain>. */
async function scatterForTicket(headers, screenId, gameId, apiHost) {
  const token = headers['X-Access-Token'] || '';
  if (!token || token.length < 10) throw new Error('Token history tidak ditemukan');
  const api = apiHost || DEFAULT_HISTORY_API;
  const r = await fetch(`${api}?t=${encodeURIComponent(token)}`, {
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
    throw new Error('Scatter tidak valid (ditemukan: ' + raw + ') — data mungkin belum siap');
  }
  return raw;
}

/* CEK penuh: history multi-hari + broad, cocokkan kode + debit>0, game 65/74,
   scatter GetBetHistory. headers = X-Access-Token admin; base = origin api. */
async function verifyClaim({ base, headers, claim, apiHost }) {
  const target = String(claim.kode_tiket || '').trim();
  const bhApi = apiHost || historyApiFor(base);
  const dates = [wibDayStr(0), wibDayStr(1), wibDayStr(2), wibDayStr(3), 'wide:' + wibDayStr(60)];
  const seens = new Set();
  const records = [];
  let lastErr = '';
  for (const day of dates) {
    if (!day) continue;
    const from = day.indexOf('wide:') === 0 ? day.slice(5) : day;
    try {
      const body = await historyList(base, headers, claim.user_id, {
        startDate: from, endDate: from, pageNo: 1, pageSize: 300
      });
      if (invalidSession(body)) { lastErr = 'session token invalid/expired'; return { lastErr, sessionInvalid: true }; }
      const rows = rowsOf(body);
      for (const r of rows) {
        const sid = recSid(r);
        if (sid && !seens.has(sid)) { seens.add(sid); records.push(r); }
      }
    } catch (e) {
      lastErr = String(e.message || e);
      if (isSessionInvalidErr(lastErr)) return { lastErr, sessionInvalid: true };
    }
  }
  let matched = null;
  for (const r of records) {
    const sid = recSid(r);
    if (!sid) continue;
    if ((sid === target || sid.includes(target)) && recDebit(r) > 0) {
      if (!matched || recDebit(r) > recDebit(matched)) matched = r;
    }
  }
  if (!matched) return { records, matched: null, actualBet: null, actualScatter: null, verdict: '', gameMismatch: false, lastErr, bhApi };

  const gameId = gameIdOf(matched);
  if (gameId !== '65' && gameId !== '74') {
    return { records, matched, actualBet: recDebit(matched) || null, actualScatter: null, verdict: recVerdict(matched), gameMismatch: true, lastErr: 'Bukan Mahjong 1 atau 2 — tolak', bhApi };
  }

  const actualBet = recDebit(matched) || null;
  let scatter = null;
  let scatterErr = '';
  try {
    scatter = await scatterForTicket(headers, target.slice(0, 19), gameId, bhApi);
  } catch (e) {
    scatterErr = String(e.message || e);
    if (isSessionInvalidErr(scatterErr)) { lastErr = 'session token invalid/expired'; return { records, matched, actualBet, actualScatter: null, verdict: recVerdict(matched), gameMismatch: false, lastErr, sessionInvalid: true, bhApi }; }
    if (/belum siap|scatter tidak valid|token history/i.test(scatterErr)) { lastErr = 'scatter belum siap: ' + scatterErr; }
    else lastErr = scatterErr;
  }
  const actualScatter = (scatter !== null && scatter >= 3 && scatter <= 5) ? scatter : null;
  return { records, matched, actualBet, actualScatter, verdict: recVerdict(matched), gameMismatch: false, lastErr: scatterErr || lastErr, bhApi };
}

/* Evaluasi kecocokan (bet + scatter). */
function compareClaim(claim, ver) {
  const reasons = [];
  if (ver.gameMismatch) reasons.push(ver.lastErr || 'bukan Mahjong 1/2');
  const scatterOk = [3, 4, 5].includes(Number(claim.scatter));
  if (!scatterOk) reasons.push('scatter klaim harus 3/4/5');
  if (ver.matched) {
    if (!ver.actualBet || Number(ver.actualBet) <= 0) reasons.push('Nilai debet tidak valid — tolak');
    if (ver.actualScatter === null || ver.actualScatter === undefined) reasons.push('scatter tidak terverifikasi (GetBetHistory)');
    else if (Number(claim.scatter) !== Number(ver.actualScatter)) reasons.push('scatter klaim ' + claim.scatter + ' vs aktual ' + ver.actualScatter);
    if (ver.actualBet === null || ver.actualBet === undefined) reasons.push('bet aktual tidak terverifikasi');
    else if (Number(claim.betting) !== Number(ver.actualBet)) reasons.push('bet klaim ' + claim.betting + ' vs aktual ' + ver.actualBet);
  } else {
    reasons.push('tiket ' + claim.kode_tiket + ' tidak ditemukan di history (debit>0)');
  }
  return { match: reasons.length === 0, reasons };
}

/* Polling verdict dari status record admin. */
async function fetchVerdict(base, headers, claim) {
  const body = await historyList(base, headers, claim.user_id, {
    startDate: wibDayStr(0), endDate: wibDayStr(0), pageNo: 1, pageSize: 300
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

module.exports = {
  jwtExpMs, baseUrlFor, wibDayStr, historyList,
  rowsOf, recSid, recDebit, gameIdOf, recVerdict,
  invalidSession, invalidSessionMsg, isSessionInvalidErr,
  domainOf, historyApiFor, scatterForTicket, verifyClaim, compareClaim, fetchVerdict,
  DEFAULT_HISTORY_API
};