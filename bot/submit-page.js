'use strict';
/* Jalur CDP: suntik form ke tab tabung bonus yang sudah login, tanpa klik manual.
   Verify di worker via jalur API (historyList) bila headers tersedia. */

import { cdpConnect } from './cdp.js';
import { FILL_SETUP } from './inject.js';

let conn = null;

async function getConn(cfg) {
  if (!conn) conn = await cdpConnect(cfg.cdp.port || 9222, cfg.cdp.urlMatch || cfg.bonus.domain);
  try {
    await conn.evaluate(FILL_SETUP);
  } catch (e) {
    conn = await cdpConnect(cfg.cdp.port || 9222, cfg.cdp.urlMatch || cfg.bonus.domain);
    await conn.evaluate(FILL_SETUP);
  }
  return conn;
}

export async function submitViaPage(cfg, claim) {
  const c = await getConn(cfg);
  const result = await c.evaluate(`window.__fillClaim(${JSON.stringify({
    userId: claim.user_id,
    hasTS: !!claim.hasTS,
    site: claim.site,
    kodeTiket: claim.kode_tiket,
    betting: Number(claim.betting),
    scatter: Number(claim.scatter)
  })})`);
  return result || { ok: false, message: 'Hasil kosong dari tab' };
}

export async function bonusApiViaPage(cfg, path, query) {
  const c = await getConn(cfg);
  return c.evaluate('window.__bonusApi(' + JSON.stringify(path) + ', ' + JSON.stringify(query || {}) + ')');
}

/* Verifikasi history dari dalam tab (same-origin): tanpa perlu token API. */
export async function historyViaPage(cfg, userId, opts) {
  const o = opts || {};
  const body = await bonusApiViaPage(cfg, '/game-oc/ida/transaction/history/queryTransactionHistoryListForUser', {
    userId: String(userId),
    pageNo: String(o.pageNo || 1),
    pageSize: String(o.pageSize || 300),
    startDate: o.startDate || '',
    endDate: o.endDate || '',
    transactionId: o.transactionId || ''
  });
  if (!body || !body.ok) return [];
  const data = body.data;
  const rows = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  return Array.isArray(rows) ? rows : [];
}