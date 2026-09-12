'use strict';
/* Klien API admin web bonus. Semua request pakai header X-Agent-* dari config.
   Endpoint hasil verifikasi (/history) sudah dipakai extension & diport di sini.
   Endpoint SUBMIT masih menunggu contoh request nyata dari dashboard. */

function hdrs(cfg) {
  return Object.assign({ 'Content-Type': 'application/json' }, cfg.bonus.headers);
}

export function wibDayStr() {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

export async function historyList(cfg, userId, { pageNo = 1, pageSize = 300, startDate = '', endDate = '', transactionId = '' } = {}) {
  const u = new URL(`https://${cfg.bonus.domain}/game-oc/ida/transaction/history/queryTransactionHistoryListForUser`);
  u.search = new URLSearchParams({ userId, pageNo: String(pageNo), pageSize: String(pageSize), startDate, endDate, transactionId }).toString();
  const r = await fetch(u, { method: 'GET', headers: hdrs(cfg) });
  if (!r.ok) throw new Error('history ' + r.status + ' ' + (await r.text()));
  return r.json();
}

export async function verifyClaim(cfg, claim) {
  const rows = await historyList(cfg, claim.user_id, { startDate: wibDayStr(), endDate: wibDayStr() });
  return { ok: true, rows: Array.isArray(rows) ? rows : (rows && rows.data) || [] };
}

export async function submitClaim(cfg, claim) {
  throw new Error('SUBMIT_ENDPOINT_NOT_DEFINED — butuh contoh request submit bonus dari Network tab dashboard (URL, method, body JSON).');
}