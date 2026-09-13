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
import * as T from './lib/tokens.js';
import * as SN from './sniffer.js';
import * as CT from './lib/cloudtokens.js';
import { submitViaPage, historyViaPage } from './submit-page.js';
import { listPages, openPage, cdpRawAll } from './cdp.js';

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
let activeBySite = {};
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
  try {
    const admin = B.adminFor(cfg, claim, { preferFresh: true });
    if (!admin) {
      const dur = claim.updated_at ? Date.now() - new Date(claim.updated_at).getTime() : 0;
      if (dur > (cfg.poll.maxRetry || 3) * 40000) {
        counts.errors++;
        await sb.updateStatus(claim.id, {
          status: 'NO_TOKEN', label: 'BUTUH SESI ADMIN',
          detail: 'Header Sniffer belum menangkap token admin untuk ' + B.hostFor(cfg, claim) + '. Buka halaman admin/history situs itu di Chrome debug (login).'
        }).catch(() => {});
        L('NOTOKEN ' + tag + ' :: ' + B.hostFor(cfg, claim));
        return;
      }
      await sb.updateStatus(claim.id, { status: 'PENDING', label: 'TUNGGU TOKEN ADMIN' }).catch(() => {});
      return;
    }

    await sb.updateStatus(claim.id, { status: 'VERIFYING', label: 'CEK' });
    const ver = await B.verifyClaimApi(cfg, claim, admin);
    if (ver.lastErr && /invalid|expired|sesi|unauthorized|401/i.test(ver.lastErr)) {
      const tries = Number((String(claim.detail || '').match(/apiRetry=(\d+)/) || [])[1] || 0);
      if (tries < (cfg.poll.maxRetry || 3)) {
        await sb.updateStatus(claim.id, { status: 'PENDING', label: 'TUNGGU TOKEN ADMIN', detail: 'apiRetry=' + (tries + 1) + ' sesi kadaluarsa — watchdog muat-ulang tab admin utk token baru.' }).catch(() => {});
        L('APISESSION-RETRY ' + tag + ' apiRetry=' + (tries + 1) + ' :: ' + ver.lastErr);
        return;
      }
      await sb.updateStatus(claim.id, { status: 'NO_TOKEN', label: 'SESI ADMIN KADALUARSA', detail: String(ver.lastErr).slice(0, 300) }).catch(() => {});
      L('APISESSION ' + tag + ' :: ' + ver.lastErr);
      return;
    }
    const cmp = B.compareClaim(claim, ver);
    counts.verified++;

    if (ver.gameMismatch) {
      counts.rejected++;
      await sb.updateStatus(claim.id, {
        status: 'REJECTED', label: 'TIDAK SESUAI', match: false,
        actual_bet: ver.actualBet, actual_scatter: ver.actualScatter,
        verdict: 'REJECTED', verdict_at: new Date().toISOString(),
        detail: '[' + ver.host + '] ' + (ver.lastErr || cmp.reasons.join('; '))
      }).catch(() => {});
      L('REJECT (bukan mahjong) ' + tag + ' :: ' + (ver.lastErr || ''));
      return;
    }

    if (!cmp.match) {
      if (ver.records.length === 0) {
        const age = Date.now() - new Date(claim.created_at || 0).getTime();
        const tries = Number((String(claim.detail || '').match(/cekr=(\d+)/) || [])[1] || 0);
        if (age < 5 * 60000 && tries < 4) {
          await sb.updateStatus(claim.id, {
            status: 'PENDING', label: 'TUNGGU DATA',
            detail: 'cekr=' + (tries + 1) + ' history kosong — dicek ulang #' + claim.claim_no + ' (' + ver.host + ')'
          }).catch(() => {});
          L('CEKEMPTY-RETRY ' + tag + ' host=' + ver.host + ' cekr=' + (tries + 1));
        } else {
          await sb.updateStatus(claim.id, {
            status: 'CEK_KOSONG', label: 'HISTORY KOSONG',
            detail: ver.host + ' tidak mengembalikan record utk ' + claim.user_id + ' (periksa sesi/host admin; atau user belum punya history).'
          }).catch(() => {});
          L('CEKEMPTY-FINAL ' + tag + ' host=' + ver.host);
        }
        return;
      }
      if (ver.matched && (ver.actualScatter === null || ver.actualScatter === undefined) && ver.lastErr) {
        const tries = Number((String(claim.detail || '').match(/scr=(\d+)/) || [])[1] || 0);
        if (tries < 4) {
          await sb.updateStatus(claim.id, {
            status: 'PENDING', label: 'TUNGGU SCATTER',
            detail: 'scr=' + (tries + 1) + ' GetBetHistory belum siap: ' + String(ver.lastErr).slice(0, 200)
          }).catch(() => {});
          L('SCATTER-RETRY ' + tag + ' scr=' + (tries + 1) + ' :: ' + ver.lastErr);
          return;
        }
      }
      counts.rejected++;
      await sb.updateStatus(claim.id, {
        status: 'REJECTED', label: 'TIDAK SESUAI', match: false,
        actual_bet: ver.actualBet, actual_scatter: ver.actualScatter,
        verdict: 'REJECTED', verdict_at: new Date().toISOString(),
        detail: '[' + ver.host + '] ' + cmp.reasons.join('; ')
      }).catch(() => {});
      L('REJECT (tidak sesuai) ' + tag + ' :: ' + cmp.reasons.join('; '));
      return;
    }

    await sb.updateStatus(claim.id, { status: 'SESUAI', label: 'ALIGN', match: true, actual_bet: ver.actualBet, actual_scatter: ver.actualScatter });
    T.saveAnchor(claim.user_id, claim.kode_tiket, claim.site || '');
    L('CEK OK ' + tag + ' bet=' + ver.actualBet + ' sc=' + ver.actualScatter + ' verdict=' + (ver.verdict || '-'));

    if (ver.verdict === 'APPROVED' || ver.verdict === 'REJECTED') { await finalize(claim, ver.verdict); return; }

    let sub;
    try {
      if (cfg.mode === 'cdp') sub = await submitViaPage(cfg, claim);
      else sub = await B.submitClaim(cfg, claim);
    } catch (e) {
      if (String(e.message).startsWith('SUBMIT_ENDPOINT_NOT_DEFINED')) throw e;
      sub = { ok: false, message: String(e.message || e) };
    }
    if (sub && sub.ok) {
      counts.ok++;
      await sb.updateStatus(claim.id, { status: 'INPUT_OK', label: 'INPUT_OK', detail: String(sub.message || '').slice(0, 500) });
      L('SUBMIT OK ' + tag + ' :: ' + (sub.message || ''));
      await pollVerdict(claim, !!admin);
    } else {
      counts.fail++;
      await sb.updateStatus(claim.id, { status: 'INPUT_FAIL', label: 'INPUT GAGAL', detail: String((sub && sub.message) || '').slice(0, 500) });
      L('SUBMIT FAIL ' + tag + ' :: ' + (sub && sub.message));
    }
  } catch (e) {
    counts.errors++;
    await sb.updateStatus(claim.id, { status: 'ERROR', label: 'ERROR', detail: String(e.message || e).slice(0, 500) }).catch(() => {});
    L('CLAIM ERROR ' + tag + ' :: ' + e.message);
  } finally {
    activeNow = activeNow.filter((x) => x.claim_no !== claim.claim_no);
  }
}

async function finalize(claim, verdict) {
  counts[verdict === 'APPROVED' ? 'approved' : 'rejected']++;
  await sb.setVerdict(claim.id, verdict).catch(() => {});
  L('VERDICT ' + verdict + ' ' + claim.claim_no);
}

async function pollVerdict(claim, canApi, attempts = 0) {
  if (attempts >= (cfg.poll.maxVerdict || 25)) {
    await sb.updateStatus(claim.id, { status: 'INPUT_OK', label: 'INPUT_OK', detail: 'belum ada verdict dari situs' }).catch(() => {});
    return;
  }
  await new Promise((r) => setTimeout(r, 15 * 1000));
  try {
    const target = String(claim.kode_tiket || '').trim();
    if (canApi) {
      const admin = B.adminFor(cfg, claim, { preferFresh: true });
      if (admin) {
        const v = await B.fetchVerdict(cfg, claim, admin);
        if (v) return finalize(claim, v);
      }
    } else {
      const rows = await historyViaPage(cfg, claim.user_id, { startDate: B.wibDayStr(), endDate: B.wibDayStr() });
      for (const r of rows) {
        const sid = String(B.recSid(r));
        const v = B.recVerdict(r);
        if (v && (sid === target || sid.includes(target) || sid.includes(claim.kode_tiket))) return finalize(claim, v);
      }
    }
  } catch (e) {
    const admin = B.adminFor(cfg, claim, { preferFresh: true });
    if (admin) {
      try {
        const v = await B.fetchVerdict(cfg, claim, admin);
        if (v) return finalize(claim, v);
      } catch (e2) {}
    }
  }
  return pollVerdict(claim, canApi, attempts + 1);
}

/* Watchdog token admin (auto-cek ±1 menit, ala extension lama):
   1) Token situs sehat -> tak ada aksi.
   2) Tab admin tak terbuka / masih di /login -> log (throttle 60s) butuh login.
   3) Tab hidup menahan halaman, token expired/missing -> muat-ulang tab sekali
      (throttle 90s, dilewati saat bot sedang submit) supaya SPA re-poll dan
      sniffer merekam token baru; kalau sesi server mati, SPA arahkan ke /login. */
let wdState = { last: 0, lastNotice: 0, lastReload: 0, lastOpen: 0 };

/* Keep-warm token history (?t= GetBetHistory) — ala autoTokenRefreshTimer
   extension: saat cache kosong/stale dan bot sedang idle, refresh lewat
   keterangan-detail (pakai anchor klaim terakhir yg SESUAI). */
let historyRefreshState = { last: 0 };
async function historyTokenLoop() {
  const now = Date.now();
  if (now - historyRefreshState.last < 60000) return;
  historyRefreshState.last = now;
  try {
    if (T.getHistoryToken()) return;
    if (active > 0) return;
    const anchor = T.getAnchor();
    if (!anchor) return;
    const s = B.siteFor(cfg, { site: anchor.site || '' });
    const host = (s && (s.historyHost || s.apiHost || s.host)) || 'ag-bandar80.idrbo2.com';
    const gameId = (s && (s.gameId || '74')) || '74';
    const tk = await B.refreshHistoryTokenViaTab(cfg, { userId: anchor.userId, sid: anchor.txId, gameId, host });
    if (tk) L('history token segar via tab [' + host + '] — GetBetHistory kini bisa dipakai.');
  } catch (e) {
    if (!/CDP/i.test(String(e.message || ''))) L('historyToken: ' + e.message);
  }
}
async function tokenWatchLoop() {
  const now = Date.now();
  if (now - wdState.last < 60000) return;
  wdState.last = now;
  try {
    const perSiteHosts = [];
    for (const s of cfg.sites || []) {
      for (const h of [s.historyHost, s.apiHost, s.host]) if (h && !perSiteHosts.includes(h)) perSiteHosts.push(h);
    }
    const allHosts = perSiteHosts.concat([cfg.bonus.domain]);
    const st = T.statusText();
    const badHosts = [];
    for (const cand of allHosts) {
      const rec = st.find((x) => x.host === cand);
      const hdrs = rec && T.forHost(cand);
      const sane = hdrs && (() => { const e = T.headerExpiryMs(hdrs); return e === null || e > Date.now() + 60000; })();
      if (!sane) badHosts.push(cand);
    }
    if (badHosts.length === 0) return;
    let pages;
    try { pages = await listPages(cfg.cdp.port || 9222); } catch (e) { return; }

    /* 1) Admin per-site: kalau tab-nya belum terbuka & token jelek -> BUKA otomatis
          ("admin cukup refresh sekali" — tab + sniffer menangkap sesi baru). */
    for (const h of badHosts) {
      if (!perSiteHosts.includes(h)) continue;
      const open = pages.find((p) => p.url && p.url.includes(h));
      if (!open) {
        if (now - wdState.lastOpen > 120000) {
          wdState.lastOpen = now;
          const target = /^https?:\/\//i.test(h) ? h : 'https://' + h;
          try {
            await openPage(cfg.cdp.port || 9222, target);
            L('WATCHDOG: tab admin ' + h + ' tidak terbuka — dibuka otomatis. Silakan LOGIN di jendela "Chrome Auto Scater" (token [' + badHosts.join(', ') + '] jelek).');
          } catch (e) { L('WATCHDOG: gagal buka tab admin ' + h + ': ' + e.message); }
        }
      } else if (/\/login(\?|$)/.test(open.url)) {
        if (now - wdState.lastNotice > 60000) { wdState.lastNotice = now; L('WATCHDOG: tab admin ' + h + ' masih di halaman LOGIN — login ulang lalu buka history/transaksi agar sniffer menangkap token baru.'); }
      }
    }

    /* 2) Tab hidup dengan token mati -> reload sekali (idle saja) supaya SPA
          re-poll dan sniffer merekam token terbaru; kalau sesi server mati,
          SPA arahkan ke /login. */
    if (active > 0) return;
    if (now - wdState.lastReload > 90000) {
      const live = pages.find((p) => p.url && badHosts.some((h) => p.url.includes(h)));
      if (live && !/\/login(\?|$)/.test(live.url)) {
        wdState.lastReload = now;
        const handles = await cdpRawAll(cfg.cdp.port || 9222, badHosts[0]);
        for (const h of handles) { try { await h.send('Page.reload', { ignoreCache: false }); } catch (e) {} try { h.close(); } catch (e) {} }
        L('WATCHDOG: token [' + badHosts.join(', ') + '] expired/missing — muat-ulang tab admin untuk re-poll token.');
      }
    }
  } catch (e) {
    if (!/CDP/i.test(String(e.message || ''))) L('watchdog: ' + e.message);
  }
}

async function pump() {
  if (cfg.paused || !cfg.enabled) return;
  let claims = [];
  try {
    const stale = (await sb.getClaims('INPUTTING', 10) || []).concat(await sb.getClaims('VERIFYING', 10) || []);
    const cutoff = Date.now() - 3 * 60000;
    for (const c of stale) {
      if (new Date(c.updated_at || 0).getTime() < cutoff) {
        await sb.updateStatus(c.id, { status: 'PENDING', label: 'ANTRI', detail: 'reclaim: gantung terdeteksi' }).catch(() => {});
        L('reclaim #' + c.claim_no + ' dari ' + (c.status || '?') + ' → PENDING');
      }
    }
  } catch (e) { L('reclaim scan gagal: ' + e.message); }
  try { claims = await sb.getClaims('PENDING', 20); } catch (e) { L('pump fetch failed'); return; }
  const bySite = {};
  for (const c of claims) {
    const s = c.site || '_';
    if (!bySite[s]) bySite[s] = [];
    bySite[s].push(c);
  }
  for (const s of Object.keys(bySite)) {
    const lim = cfg.poll.perSiteConcurrent || 2;
    for (const c of bySite[s]) {
      if ((activeBySite[s] || 0) >= lim) break;
      active++;
      activeBySite[s] = (activeBySite[s] || 0) + 1;
      processClaim(c).finally(() => {
        active--;
        activeBySite[s] = Math.max(0, (activeBySite[s] || 0) - 1);
      });
    }
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
  // Header Sniffer: pasang pe-ngintip request di tab (Network) + patch fetch/XHR.
  // Token admin yang tertangkap otomatis dipakai CEK/verdict via API (bonus.js).
  const sniffKnown = new Set(T.allHosts());
  const snifferLoop = async () => {
    try {
      await SN.ensure(cfg, (host) => {
        if (!sniffKnown.has(host)) {
          sniffKnown.add(host);
          L('Header admin terekam [' + host + '] — CEK/verdict kini pakai API, bukan tab.');
        }
      });
      const st = T.statusText();
      const ghost = st.filter((x) => !sniffKnown.has(x.host)).map((x) => x.host);
      for (const h of ghost) { sniffKnown.add(h); L('Header admin terekam [' + h + '] — CEK/verdict kini pakai API, bukan tab.'); }
    } catch (e) {
      if (!/cdp\|sniffer/.test(e.message)) L('sniffer: ' + e.message);
    }
    try {
      const n = await CT.pull(cfg.supabase);
      if (n > 0) L('cloud tokens +' + n + ' — CEK/verdict kini pakai API, bukan tab.');
    } catch (e) {
      if (!/relation|tidak ada|404/i.test(String(e.message || ''))) L('cloudtokens: ' + e.message);
    }
    try {
      const m = await CT.pushAll(cfg.supabase);
      if (m > 0) L('header admin disinkron ke cloud [' + m + ' host].');
    } catch (e) {
      if (!/relation|tidak ada|404/i.test(String(e.message || ''))) L('cloudpush: ' + e.message);
    }
  };
  await snifferLoop();
  setInterval(snifferLoop, 10000);
  setInterval(() => { tokenWatchLoop().catch(() => {}); }, 15000);
  setInterval(() => { historyTokenLoop().catch(() => {}); }, 60000);
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