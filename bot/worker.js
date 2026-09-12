'use strict';
/* Worker 1-PC: proses antrian klaim dari Supabase -> API bonus -> verdict.
   Jalankan: node bot/worker.js
   Mensyaratkan bot/config.local.js ada (salin dari config.example.js). */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sbEnv } from './lib/supabase.js';
import * as B from './lib/bonus.js';
import { submitViaPage } from './submit-page.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfgPath = path.join(__dirname, 'config.local.js');

let cfg;
try {
  cfg = (await import(pathToFileURL(cfgPath).href)).default;
} catch (e) {
  console.error('config.local.js belum ada. Salin bot/config.example.js -> bot/config.local.js lalu isi nilainya.');
  process.exit(1);
}

if (!cfg.supabase.key) { console.error('config.local.js: supabase.key kosong.'); process.exit(1); }

const sb = sbEnv(cfg.supabase);
const L = (m) => console.log(new Date().toISOString(), m);
let active = 0;

async function processClaim(claim) {
  const tag = '#' + claim.claim_no + ' ' + claim.user_id;
  const hasAdminApi = !!(cfg.bonus && cfg.bonus.headers && cfg.bonus.headers['X-Access-Token']);
  try {
    if (hasAdminApi) {
      await sb.updateStatus(claim.id, { status: 'VERIFYING', label: 'CEK' });
      const ver = await B.verifyClaim(cfg, claim);
      L('VERIFY OK ' + tag + (ver.rows ? ' rows=' + ver.rows.length : ''));
      await sb.updateStatus(claim.id, { status: 'SESUAI', label: 'VERIFIKASI BERHASIL', match: true });
    }
    try {
      let sub;
      if (cfg.mode === 'cdp') sub = await submitViaPage(cfg, claim);
      else sub = await B.submitClaim(cfg, claim);
      const ok = !!(sub && sub.ok);
      await sb.updateStatus(claim.id, { status: ok ? 'INPUT_OK' : 'INPUT_FAIL', label: ok ? 'INPUT_OK' : 'INPUT GAGAL', detail: String((sub && sub.message) || '').slice(0, 500) });
      L((ok ? 'SUBMIT OK ' : 'SUBMIT FAIL ') + tag + (ok ? '' : ' :: ' + (sub && sub.message)));
      if (ok && hasAdminApi) await pollVerdict(claim);
    } catch (e) {
      if (String(e.message).startsWith('SUBMIT_ENDPOINT_NOT_DEFINED')) throw e;
      await sb.updateStatus(claim.id, { status: 'INPUT_FAIL', label: 'INPUT GAGAL', detail: String(e.message || e).slice(0, 500) });
      L('SUBMIT FAIL ' + tag + ' :: ' + e.message);
    }
  } catch (e) {
    await sb.updateStatus(claim.id, { status: 'ERROR', label: 'ERROR', detail: String(e.message || e).slice(0, 500) }).catch(() => {});
    L('CLAIM ERROR ' + tag + ' :: ' + e.message);
  }
}

async function pollVerdict(claim, attempts = 0) {
  if (attempts >= 120) {
    await sb.updateStatus(claim.id, { status: 'INPUT_OK', label: 'INPUT_OK', detail: 'belum ada verdict dari situs' });
    return;
  }
  await new Promise((r) => setTimeout(r, 60 * 1000));
  try {
    const ver = await B.historyList(cfg, claim.user_id, { startDate: B.wibDayStr(), endDate: B.wibDayStr() });
    const rows = Array.isArray(ver) ? ver : (ver && ver.data) || [];
    const hit = rows.find((x) => String(x.transactionId || x.id || '').includes(claim.kode_tiket));
    if (hit) {
      const st = String(hit.status || hit.state || '').toUpperCase();
      if (st === 'APPROVED' || st === 'SUCCESS') { await sb.setVerdict(claim.id, 'APPROVED'); L('VERDICT APPROVED ' + claim.claim_no); return; }
      if (st === 'REJECTED' || st === 'FAIL') { await sb.setVerdict(claim.id, 'REJECTED'); L('VERDICT REJECTED ' + claim.claim_no); return; }
    }
  } catch (e) { /* tunggu putaran berikutnya */ }
  return pollVerdict(claim, attempts + 1);
}

async function pump() {
  if (active >= (cfg.poll.perSiteConcurrent || 2)) return;
  const claims = await sb.getClaims('PENDING', 20);
  for (const c of claims) {
    if (active >= (cfg.poll.perSiteConcurrent || 2)) break;
    active++;
    processClaim(c).finally(() => active--);
  }
}

async function main() {
  if (cfg.mode === 'cdp') {
    try {
      const { cdpConnect } = await import('./cdp.js');
      const conn = await cdpConnect(cfg.cdp?.port || 9222, cfg.cdp?.urlMatch || '');
      L('CDP connect OK ke tab: ' + conn.tabUrl);
    } catch (e) {
      console.error('CDP gagal: ' + e.message + ' — jalankan bot/open-chrome.ps1 lalu buka halaman bonus di Chrome itu.');
      process.exit(1);
    }
  }
  console.log('Scater bot start. mode=' + cfg.mode + ' poll=' + cfg.poll.intervalMs + 'ms conc=' + cfg.poll.perSiteConcurrent);
  setInterval(() => { pump().catch((e) => L('pump error ' + e.message)); }, cfg.poll.intervalMs || 2500);
  pump().catch((e) => L('pump error ' + e.message));
}

main();
