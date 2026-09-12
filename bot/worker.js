'use strict';
/* Worker daemon 1-PC — dikendalikan Panel Master (autoscater1-master).
   Jalankan: node bot/worker.js   (opsional flag --smoke utk cek cepat)
   Alur: baca antrian claims (PENDING) -> verifikasi history (opsional) ->
         input ke situs bonus (CDP/Chrome owner) -> cek verdict.
   Heartbeat + perintah (pause/resume/poll_now/reload/shutdown) lewat tabel
   Supabase worker_* (web/supabase/worker.sql). Bila tabel belum dibuat,
   daemon tetap jalan mode lokal. Mensyaratkan bot/config.local.js. */

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sbEnv } from './lib/supabase.js';
import { workerControl, isSetupError } from './lib/control.js';
import * as B from './lib/bonus.js';
import { submitViaPage } from './submit-page.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfgPath = path.join(__dirname, 'config.local.js');
const SMOKE = process.argv.includes('--smoke');
const VERSION = '2.0.0';

let cfg;
try {
  cfg = (await import(pathToFileURL(cfgPath).href)).default;
} catch (e) {
  console.error('config.local.js belum ada. Salin bot/config.example.js -> bot/config.local.js lalu isi nilainya.');
  process.exit(1);
}
if (!cfg.supabase.key) { console.error('config.local.js: supabase.key kosong.'); process.exit(1); }

cfg.cdp = cfg.cdp || { port: 9222, urlMatch: 'bonussmb.com' };
cfg.poll = cfg.poll || { intervalMs: 2500, perSiteConcurrent: 2, maxRetry: 3 };
cfg.bonus = cfg.bonus || { domain: 'bonussmb.com', headers: {} };
if (!('enabled' in cfg)) cfg.enabled = true;
if (!('paused' in cfg)) cfg.paused = false;

const sb = sbEnv(cfg.supabase);
const ctl = workerControl(cfg.supabase);
const L = (m) => console.log(new Date().toISOString(), m);
const HOSTNAME = os.hostname();

let dbOk = false;          // worker_* tersedia (kontrollable via Panel)
let dbNotified = false;
let active = 0;
let activeNow = [];
let shuttingDown = false;
let counts = { processed: 0, verified: 0, ok: 0, fail: 0, approved: 0, rejected: 0, errors: 0 };

async function reloadConfig() {
  try {
    const c = await ctl.config();
    if (c) {
      if (c.mode) cfg.mode = c.mode;
      cfg.enabled = !!c.enabled;
      cfg.paused = !!c.paused;
      if (c.cdp_port) cfg.cdp.port = c.cdp_port;
      if (c.cdp_url_match) cfg.cdp.urlMatch = c.cdp_url_match;
      else cfg.cdp.urlMatch = cfg.cdp.urlMatch || cfg.bonus.domain;
      if (c.poll_interval_ms) cfg.poll.intervalMs = c.poll_interval_ms;
      if (c.per_site_concurrent) cfg.poll.perSiteConcurrent = c.per_site_concurrent;
      if (c.max_retry) cfg.poll.maxRetry = c.max_retry;
      if (c.bonus_domain) cfg.bonus.domain = c.bonus_domain;
      dbOk = true;
      if (dbNotified) { dbNotified = false; L('DB worker_* tersedia — daemon terkendali Panel Master.'); }
      return true;
    }
  } catch (e) {
    dbOk = false;
    if (!dbNotified) {
      dbNotified = true;
      L('Peringatan: tabel worker_* belum dibuat (jalankan web/supabase/worker.sql di SQL Editor). Daemon tetap jalan mode lokal.');
    }
  }
  if (SMOKE) console.log('[smoke] config:', JSON.stringify({
    mode: cfg.mode, enabled: cfg.enabled, paused: cfg.paused,
    poll: cfg.poll.intervalMs, conc: cfg.poll.perSiteConcurrent, domain: cfg.bonus.domain
  }));
  return false;
}

async function beat() {
  if (!dbOk) return;
  try {
    const now = new Date().toISOString();
    await ctl.beat({
      online: !shuttingDown,
      version: VERSION,
      hostname: HOSTNAME,
      status: shuttingDown ? 'offline' : cfg.paused ? 'paused' : (active > 0 ? 'running' : 'idle'),
      mode: cfg.mode,
      last_seen: now,
      counts,
      current: (cfg.mode === 'cdp' && !activeNow.length && !cfg.paused) ? [] : activeNow
    }, now);
  } catch (e) {
    if (isSetupError(e)) dbOk = false;
  }
}

async function commandLoop() {
  if (!dbOk) return;
  let cmds;
  try { cmds = await ctl.commands(); }
  catch (e) { if (isSetupError(e)) dbOk = false; return; }
  for (const c of cmds || []) {
    const act = String(c.action || '');
    let ok = true;
    let result = 'ok';
    try {
      if (act === 'pause') { cfg.paused = true; }
      else if (act === 'resume') { cfg.paused = false; }
      else if (act === 'start') { cfg.paused = false; if (!cfg.enabled) cfg.enabled = true; }
      else if (act === 'poll_now') { await pump(); }
      else if (act === 'reload') { await reloadConfig(); }
      else if (act === 'shutdown') { await beat(); process.exit(0); }
      else { ok = false; result = 'unknown action: ' + act; }
    } catch (e) { ok = false; result = String(e.message || e).slice(0, 300); }
    L('CMD ' + act + ' -> ' + (ok ? 'done' : 'failed') + (ok ? '' : ' :: ' + result));
    await ctl.commandDone(c.id, ok, result).catch(() => {});
  }
}

async function processClaim(claim) {
  const tag = '#' + claim.claim_no + ' ' + claim.user_id;
  if (!claim.id) return;
  counts.processed++;
  activeNow.push({ claim_no: claim.claim_no, user_id: claim.user_id, site: claim.site });
  const hasAdminApi = !!(cfg.bonus && cfg.bonus.headers && cfg.bonus.headers['X-Access-Token']);
  try {
    if (hasAdminApi) {
      await sb.updateStatus(claim.id, { status: 'VERIFYING', label: 'CEK' });
      const ver = await B.verifyClaim(cfg, claim);
      counts.verified++;
      L('VERIFY OK ' + tag + (ver.rows ? ' rows=' + ver.rows.length : ''));
      await sb.updateStatus(claim.id, { status: 'SESUAI', label: 'VERIFIKASI BERHASIL', match: true });
    }
    try {
      let sub;
      if (cfg.mode === 'cdp') sub = await submitViaPage(cfg, claim);
      else sub = await B.submitClaim(cfg, claim);
      const ok = !!(sub && sub.ok);
      if (ok) counts.ok++; else counts.fail++;
      await sb.updateStatus(claim.id, {
        status: ok ? 'INPUT_OK' : 'INPUT_FAIL',
        label: ok ? 'INPUT_OK' : 'INPUT GAGAL',
        detail: String((sub && sub.message) || '').slice(0, 500)
      });
      L((ok ? 'SUBMIT OK ' : 'SUBMIT FAIL ') + tag + (ok ? '' : ' :: ' + (sub && sub.message)));
      if (ok && hasAdminApi) await pollVerdict(claim);
    } catch (e) {
      if (String(e.message).startsWith('SUBMIT_ENDPOINT_NOT_DEFINED')) throw e;
      counts.fail++;
      await sb.updateStatus(claim.id, { status: 'INPUT_FAIL', label: 'INPUT GAGAL', detail: String(e.message || e).slice(0, 500) });
      L('SUBMIT FAIL ' + tag + ' :: ' + e.message);
    }
  } catch (e) {
    counts.errors++;
    await sb.updateStatus(claim.id, { status: 'ERROR', label: 'ERROR', detail: String(e.message || e).slice(0, 500) }).catch(() => {});
    L('CLAIM ERROR ' + tag + ' :: ' + e.message);
  } finally {
    activeNow = activeNow.filter((x) => x.claim_no !== claim.claim_no);
  }
}

async function pollVerdict(claim, attempts = 0) {
  if (attempts > 120) {
    await sb.updateStatus(claim.id, { status: 'INPUT_OK', label: 'INPUT_OK', detail: 'belum ada verdict dari situs' });
    return;
  }
  await new Promise((r) => setTimeout(r, 30 * 1000));
  try {
    const ver = await B.historyList(cfg, claim.user_id, { startDate: B.wibDayStr(), endDate: B.wibDayStr() });
    const rows = Array.isArray(ver) ? ver : (ver && ver.data) || [];
    const hit = rows.find((x) => String(x.transactionId || x.id || '').includes(claim.kode_tiket));
    if (hit) {
      const st = String(hit.status || hit.state || '').toUpperCase();
      if (st === 'APPROVED' || st === 'SUCCESS') { counts.approved++; await sb.setVerdict(claim.id, 'APPROVED'); L('VERDICT APPROVED ' + claim.claim_no); return; }
      if (st === 'REJECTED' || st === 'FAIL') { counts.rejected++; await sb.setVerdict(claim.id, 'REJECTED'); L('VERDICT REJECTED ' + claim.claim_no); return; }
    }
  } catch (e) { /* tunggu putaran berikutnya */ }
  return pollVerdict(claim, attempts + 1);
}

async function pump() {
  if (cfg.paused || !cfg.enabled) return;
  if (active >= (cfg.poll.perSiteConcurrent || 2)) return;
  const claims = await sb.getClaims('PENDING', 20);
  for (const c of claims) {
    if (active >= (cfg.poll.perSiteConcurrent || 2)) break;
    active++;
    processClaim(c).finally(() => active--);
  }
}

async function actualShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(sig + ' → shutdown.');
  try { await beat(); } catch (_) {}
  process.exit(0);
}

async function main() {
  await reloadConfig();
  if (cfg.mode === 'cdp' && !SMOKE) {
    try {
      const { cdpConnect } = await import('./cdp.js');
      const conn = await cdpConnect(cfg.cdp.port || 9222, cfg.cdp.urlMatch || '');
      L('CDP connect OK ke tab: ' + conn.tabUrl);
      try { conn.close(); } catch (_) {}
    } catch (e) {
      L('CDP belum terhubung: ' + e.message + ' — jalankan bot/open-chrome.ps1 lalu buka halaman bonus di Chrome itu. Daemon tetap hidup.');
    }
  }
  console.log('Scater daemon start. mode=' + cfg.mode + ' poll=' + cfg.poll.intervalMs + 'ms conc=' + cfg.poll.perSiteConcurrent + ' db=' + (dbOk ? 'panel' : 'lokal'));
  setInterval(() => { pump().catch((e) => L('pump ' + e.message)); }, cfg.poll.intervalMs || 2500);
  setInterval(() => { commandLoop().catch((e) => L('cmd ' + e.message)); }, 3000);
  setInterval(() => { beat().catch(() => {}); }, 5000);
  pump().catch((e) => L('pump ' + e.message));
  process.on('SIGINT', () => actualShutdown('SIGINT'));
  process.on('SIGTERM', () => actualShutdown('SIGTERM'));

  if (SMOKE) {
    await new Promise((r) => setTimeout(r, 900));
    beat().catch(() => {});
    console.log('[smoke] OK');
    process.exit(0);
  }
}

main();