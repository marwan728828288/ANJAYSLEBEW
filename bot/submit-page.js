'use strict';
/* Jalur CDP: suntik form ke tab tabung bonus yang sudah login, tanpa klik manual.
   Verify di worker via jalur API (historyList) bila headers tersedia. */

import { cdpConnect } from './cdp.js';
import { FILL_SETUP } from './inject.js';

let conn = null;

async function getConn(cfg) {
  if (conn) return conn;
  conn = await cdpConnect(cfg.cdp.port || 9222, cfg.cdp.urlMatch || cfg.bonus.domain);
  await conn.evaluate(FILL_SETUP);
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