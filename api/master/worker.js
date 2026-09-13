'use strict';
/* /api/worker → router tunggal (hemat lambda di Hobby: 1 fungsi, bukan 3).
   - GET  /api/worker             → status daemon + config + perintah terakhir (izin pantau)
   - POST /api/worker/config      → simpan parameter (izin approve)
   - POST /api/worker/command     → antrekan aksi utk daemon (izin approve)
   Jika tabel belum dibuat → setup=false (panel menampilkan petunjuk).

   PIPA 3 FASE (pipeline klaim server-side):
     A CEK    : PENDING → VERIFYING → SESUAI (actual_bet/actual_scatter/match, hadiah
                                            via scater-lib.calcHadiah) | REJECTED |
                TIDAK_SESUAI | CEK_KOSONG | NO_TOKEN | ERROR   [+ cekr=/scr= retry]
     B INPUT  : SESUAI → (payload.bonus_submit) → INPUT_OK (+secure_status/secure_detail)
                        → INPUT_FAIL (inputerr=n / INPUT GAGAL) | INPUTTING(BUTUH ENDPOINT)
                Feature-off default (tanpa payload.bonus_submit & require_input → tak jalan).
     C VERDICT: INPUT_OK (atau SESUAI saat input tak diminta) → (payload.verdict_poll)
                → APPROVED/REJECTED via finalizeVerdict (+ detail last_polled_at).
   Kolom baru (hadiah/secure_status/secure_detail) ditulis AMAN: bila kolom tak ada di
   tabel (migrate_phase2.sql belum jalan), PATCH diulang tanpa kolom itu — tidak pernah
   crash loop.
   Konfigurasi payload (JSON worker_config):
     payload.bonus_submit = { url:'…{{userId}}/{{kodeTiket}}/{{bonusToken}}…', method,
                              contentType, headers, body|bodyJson|fields, max_retry (dft 3) }
     payload.require_input = true → bila bonus_submit kosong, status INPUTTING.
     payload.verdict_poll  = { url:'…{{kode}}/{{site}}…', method, headers } atau string url. */
const L = require('./_lib');
const C = require('./claim-lib');
const S = require('./scater-lib');
const R = require('./relax-lib');

const NUM = {
  cdp_port: [1, 65535],
  poll_interval_ms: [500, 600000],
  per_site_concurrent: [1, 50],
  max_retry: [0, 20]
};
const ACTIONS = ['start', 'pause', 'resume', 'poll_now', 'reload', 'shutdown'];

function intOf(v, min, max) {
  const n = parseInt(v, 10);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

async function handleGet(res) {
  let rows, cfg, cmds;
  try {
    rows = await L.sbGet('worker_state', 'select=*&id=eq.1', L.SB_SVC || undefined);
  } catch (e) {
    return L.ok(res, { ok: true, setup: false, reason: 'Tabel worker belum ada. Jalankan web/supabase/worker.sql di Supabase SQL Editor.' }, { 'Cache-Control': 'no-store' });
  }
  try {
    cfg = await L.sbGet('worker_config', 'select=*&id=eq.1', L.SB_SVC || undefined);
    cmds = await L.sbGet('worker_commands', 'select=id,action,status,result,created_at&order=created_at.desc&limit=8', L.SB_SVC || undefined);
  } catch (e) {
    cfg = []; cmds = [];
  }
  const state = (Array.isArray(rows) && rows[0]) || null;
  const config = (Array.isArray(cfg) && cfg[0]) || null;
  return L.ok(res, {
    ok: true,
    setup: true,
    online: !!(state && state.online),
    ageMs: state && state.last_seen ? Date.now() - new Date(state.last_seen).getTime() : null,
    state: state && {
      version: state.version,
      hostname: state.hostname,
      status: state.status,
      mode: state.mode,
      last_seen: state.last_seen,
      started_at: state.started_at,
      counts: state.counts || {},
      current: state.current || {},
      detail: state.detail
    },
    config: config && {
      mode: config.mode,
      cdp_port: config.cdp_port,
      cdp_url_match: config.cdp_url_match,
      poll_interval_ms: config.poll_interval_ms,
      per_site_concurrent: config.per_site_concurrent,
      max_retry: config.max_retry,
      bonus_domain: config.bonus_domain,
      enabled: config.enabled,
      paused: config.paused,
      payload: config.payload || {},
      updated_at: config.updated_at
    },
    commands: Array.isArray(cmds) ? cmds : []
  }, { 'Cache-Control': 'no-store' });
}

async function handleConfig(req, res) {
  if (!L.SB_SVC) return L.fail(res, 'Supabase SERVICE KEY belum diatur di Vercel.');
  let body;
  try { body = await L.readBody(req, 16 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }

  const changes = {};
  const set = {};

  if (body.mode !== undefined) {
    const m = String(body.mode);
    if (m !== 'cdp' && m !== 'api') return L.bad(res, 'BAD_MODE', 'Mode harus cdp atau api.');
    changes.mode = m; set.mode = m;
  }
  if (body.bonus_domain !== undefined) {
    const s = String(body.bonus_domain).trim().slice(0, 120);
    if (!/^[a-zA-Z0-9.-]{3,120}$/.test(s)) return L.bad(res, 'BAD_DOMAIN', 'Domain tidak valid.');
    changes.bonus_domain = s; set.bonus_domain = s;
  }
  if (body.cdp_url_match !== undefined) {
    const s = String(body.cdp_url_match).trim().slice(0, 120);
    changes.cdp_url_match = s; set.cdp_url_match = s;
  }
  ['cdp_port', 'poll_interval_ms', 'per_site_concurrent', 'max_retry'].forEach(function (k) {
    if (body[k] === undefined) return;
    const n = intOf(body[k], NUM[k][0], NUM[k][1]);
    if (n === null) return L.bad(res, 'BAD_NUM_' + k.toUpperCase(), 'Nilai ' + k + ' di luar jangkauan.');
    changes[k] = n; set[k] = n;
  });
  if (body.enabled !== undefined) { changes.enabled = !!body.enabled; set.enabled = changes.enabled; }
  if (body.paused !== undefined) { changes.paused = !!body.paused; set.paused = changes.paused; }
  if (body.payload !== undefined && body.payload !== null && typeof body.payload === 'object') {
    changes.payload = body.payload; set.payload = changes.payload;
  }

  if (!Object.keys(changes).length) return L.bad(res, 'EMPTY', 'Tidak ada field yang diubah.');

  try {
    await L.sbPatchRow('worker_config', 1, changes, L.SB_SVC);
    return L.ok(res, { ok: true, saved: set });
  } catch (e) {
    if (String(e.message).indexOf('PGRST205') >= 0) return L.fail(res, 'Tabel worker belum dibuat. Jalankan web/supabase/worker.sql di SQL Editor.');
    return L.fail(res, 'Gagal menyimpan konfigurasi worker.');
  }
}

async function handleCommand(req, res) {
  if (!L.SB_SVC) return L.fail(res, 'Supabase SERVICE KEY belum diatur di Vercel.');
  let body;
  try { body = await L.readBody(req, 16 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }

  const action = String((body && body.action) || '').trim();
  if (ACTIONS.indexOf(action) < 0) return L.bad(res, 'BAD_ACTION', 'Aksi tidak dikenal.');

  const payload = (body && body.payload && typeof body.payload === 'object') ? body.payload : {};

  try {
    await L.sbInsert('worker_commands', { action, payload }, L.SB_SVC);
    return L.ok(res, { ok: true, action });
  } catch (e) {
    if (String(e.message).indexOf('PGRST205') >= 0) return L.fail(res, 'Tabel worker belum dibuat. Jalankan web/supabase/worker.sql di SQL Editor.');
    return L.fail(res, 'Gagal mengirim perintah ke worker.');
  }
}

/* Decode exp JWT (ms) tanpa verifikasi signature. */
function jwtExpMs(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const pay = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return typeof pay.exp === 'number' ? pay.exp * 1000 : null;
  } catch (e) { return null; }
}

async function handleTokens(req, res) {
  const method = req.method;
  if (method === 'DELETE') {
    if (!L.SB_SVC) return L.fail(res, 'Supabase SERVICE KEY belum diatur di Vercel.');
    let body;
    try { body = await L.readBody(req, 64 * 1024); }
    catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }
    const hosts = Array.isArray(body && body.hosts) ? body.hosts.map((s) => String(s).trim()).filter(Boolean) : [];
    if (!hosts.length) return L.bad(res, 'BAD_HOSTS', 'hosts kosong.');
    let deleted = 0;
    for (const h of hosts) {
      try {
        const res2 = await fetch(L.SB_URL + '/rest/v1/worker_tokens?host=eq.' + encodeURIComponent(h), {
          method: 'DELETE',
          headers: L.sbh(null, L.SB_SVC)
        });
        const t = await res2.text();
        if (res2.ok) deleted++;
        else return L.fail(res, 'Gagal hapus ' + h + ': DB ' + res2.status + ' ' + t);
      } catch (e) { return L.fail(res, 'Gagal hapus token ' + h + '.'); }
    }
    return L.ok(res, { ok: true, deleted });
  }

  let rows = [];
  try {
    rows = await L.sbGet('worker_tokens', 'select=id,host,base,headers,captured_at&order=captured_at.desc&limit=100', L.SB_SVC || undefined);
  } catch (e) {
    return L.ok(res, { ok: true, setup: false, tokens: [], reason: 'Tabel worker_tokens belum ada. Jalankan bot/supabase/worker_tokens.sql di SQL Editor.' });
  }
  const now = Date.now();
  const tokens = (Array.isArray(rows) ? rows : []).map((r) => {
    const h = (r && r.headers) || {};
    const tok = h['X-Access-Token'] || '';
    const exp = jwtExpMs(tok);
    return {
      id: r.id,
      host: r.host,
      base: r.base || null,
      captured_at: r.captured_at || null,
      ok: !!(tok && tok.length >= 10),
      fresh: exp !== null && exp > now,
      exp_at: exp,
      token_masked: tok ? tok.slice(0, 12) + '…' + tok.slice(-6) : ''
    };
  });
  return L.ok(res, { ok: true, setup: true, count: tokens.length, tokens }, { 'Cache-Control': 'no-store' });
}

/* ============ Sesi admin (paste di panel) — web-only ============ */
/* Simpan/timpa headers X-Access-Token sebuah situs ke worker_tokens.
   Row baru (id serial) — pembacaan selalu ambil baris TERBARU per host. */
async function handleTokenSave(req, res) {
  if (!L.SB_SVC && !L.SB_KEY) return L.fail(res, 'Supabase key belum diatur di Vercel.');
  let body;
  try { body = await L.readBody(req, 64 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }
  const host = String(body.host || '').trim().replace(/^https?:\/\//, '').split('/')[0];
  if (!host || !/^[a-zA-Z0-9.-]{3,200}$/.test(host)) return L.bad(res, 'BAD_HOST', 'host tidak valid.');
  const headers = (body.headers && typeof body.headers === 'object') ? body.headers : {};
  const tok = String(headers['X-Access-Token'] || headers['x-access-token'] || '').trim();
  if (body.clear) {
    const r = await fetch(L.SB_URL + '/rest/v1/worker_tokens?host=eq.' + encodeURIComponent(host), {
      method: 'DELETE', headers: L.sbh(null, L.SB_SVC)
    });
    const t = await r.text();
    if (!r.ok) return L.fail(res, 'Gagal hapus token ' + host + ': DB ' + r.status + ' ' + t);
    return L.ok(res, { ok: true, cleared: host });
  }
  /* bersihkan prefix "X-Access-Token\t..." bila user paste header mentah */
  const clean = {};
  const m = tok.match(/^(X-[A-Za-z0-9-]+)[\t\r\n](.*)$/);
  if (m) clean['X-Access-Token'] = m[2].trim(); else clean['X-Access-Token'] = tok;
  for (const k of ['X-Agent-Pkid', 'X-Agent-Role', 'X-Agent-Suid', 'X-Agent-User', 'X-Agent-UserId', 'x-agent-voice']) {
    const v = headers[k] !== undefined ? headers[k] : headers[k.toLowerCase()];
    if (v === undefined || v === null || v === '') continue;
    const hk = k.startsWith('x-') ? k.replace(/^x-/, 'X-') : k;
    clean[hk] = String(v).trim();
  }
  if (!clean['X-Access-Token'] || clean['X-Access-Token'].length < 10) return L.bad(res, 'BAD_TOKEN', 'X-Access-Token kosong/terlalu pendek.');
  const base = String(body.base || '').trim().replace(/\/+$/, '');
  try {
    await L.sbInsert('worker_tokens', { host, base: base || 'https://' + host, headers: clean, captured_at: new Date().toISOString() }, L.SB_SVC);
  } catch (e) {
    if (String(e.message).indexOf('PGRST205') >= 0) return L.fail(res, 'Tabel worker_tokens belum dibuat. Jalankan bot/supabase/worker_tokens.sql di SQL Editor.');
    return L.fail(res, 'Gagal menyimpan token.');
  }
  return L.ok(res, { ok: true, host, saved: true });
}

/* ============ Prosesor claim server-side (cron Vercel + panel) ============ */

const PROCESS_LIMIT = 6;
const PROCESS_BUDGET_MS = 42000;

function sbAdmKey() { return L.SB_SVC || L.SB_KEY; }

async function sbRows(table, qs) {
  const r = await fetch(L.SB_URL + '/rest/v1/' + table + (qs ? '?' + qs : ''), { headers: L.sbh(null, sbAdmKey()) });
  if (!r.ok) { const t = await r.text(); throw new Error('DB ' + table + ' ' + r.status + ': ' + t); }
  return r.json();
}

async function sbClaimPatch(id, obj, guardStatus) {
  let qs = 'id=eq.' + encodeURIComponent(id);
  if (guardStatus) qs += '&status=eq.' + encodeURIComponent(guardStatus);
  const r = await fetch(L.SB_URL + '/rest/v1/claims?' + qs, {
    method: 'PATCH',
    headers: L.sbh('return=representation', sbAdmKey()),
    body: JSON.stringify(obj)
  });
  const t = await r.text();
  if (!r.ok) throw new Error('DB claims PATCH ' + r.status + ': ' + t);
  if (!t) return [];
  try { return JSON.parse(t); } catch (e) { return []; }
}

/* Kolom BARU fase 2 (migrate_phase2.sql) — ditulis via sbClaimPatchNew:
   bila kolom belum ada di tabel, PATCH csg-aman diulang tanpa kolom itu. */
const NEW_CLAIM_COLUMNS = ['hadiah', 'secure_status', 'secure_detail'];
let _claimsNewColsCache = null;
let _claimsNewColsAt = 0;

/* Cek ringan kolom claims (select=*&limit=1) sekali per proses, cache 60 dtk. */
async function claimsInfo() {
  if (_claimsNewColsCache && Date.now() - _claimsNewColsAt < 60000) return _claimsNewColsCache;
  const has = {};
  try {
    const r = await sbRows('claims', 'select=*&limit=1');
    const row = (Array.isArray(r) && r[0]) || {};
    for (const c of NEW_CLAIM_COLUMNS) has[c] = Object.prototype.hasOwnProperty.call(row, c);
  } catch (e) {
    for (const c of NEW_CLAIM_COLUMNS) has[c] = true; /* tak sempat cek → biar fallback PATCH */
  }
  _claimsNewColsCache = has;
  _claimsNewColsAt = Date.now();
  return has;
}

/* PATCH claims yang boleh membawa kolom baru; kolom baru hanya dikirim bila
   kolomnya diketahui ada, kalau tidak dihilangkan (tulis transisi selalu jalan). */
async function sbClaimPatchNew(id, obj, guardStatus) {
  const info = _claimsNewColsCache || {};
  const send = {};
  for (const k of Object.keys(obj)) {
    if (NEW_CLAIM_COLUMNS.indexOf(k) >= 0 && info[k] === false) continue;
    send[k] = obj[k];
  }
  try {
    return await sbClaimPatch(id, send, guardStatus);
  } catch (e) {
    if (Object.keys(send).every((k) => NEW_CLAIM_COLUMNS.indexOf(k) < 0)) throw e;
    const core = {};
    for (const k of Object.keys(send)) if (NEW_CLAIM_COLUMNS.indexOf(k) < 0) core[k] = send[k];
    return sbClaimPatch(id, core, guardStatus);
  }
}

/* Tag klasifikasi scater-extension untuk memperkaya detail (retry/session-timeout). */
function scaterTag(msg) {
  const cls = S.klaimClassifyBonusError(String(msg || ''));
  return (cls === 'RETRY' || cls === 'SESSION_TIMEOUT') ? ' [' + cls + ']' : '';
}

/* Ambil token admin terbaru utk sebuah klaim (site → bonus → host mana pun). */
async function findAdminFor(claim, bestByHost, sites, bonusDomain) {
  const cands = [];
  for (const s of sites || []) {
    if (String(s.siteId || '').toLowerCase() === String(claim.site || '').toLowerCase()) {
      for (const h of [s.historyHost, s.apiHost, s.host]) if (h) cands.push(String(h).replace(/^https?:\/\//, '').split('/')[0]);
    }
  }
  cands.push(String(bonusDomain || '').replace(/^https?:\/\//, '').split('/')[0]);
  cands.push.apply(cands, Array.from(bestByHost.keys()));
  for (const host of cands) {
    if (!host) continue;
    const row = bestByHost.get(host);
    if (!row) continue;
    const headers = (row.headers && typeof row.headers === 'object') ? row.headers : {};
    const tok = String(headers['X-Access-Token'] || '').trim();
    if (tok.length < 10) continue;
    const exp = C.jwtExpMs(tok);
    const base = C.baseUrlFor(row);
    if (!base) continue;
    return { host, base, headers, expired: exp !== null && exp < Date.now() + 60000 };
  }
  return null;
}

function retryCount(detail, tag) {
  const m = String(detail || '').match(new RegExp(tag + '=(\\d+)'));
  return m ? parseInt(m[1], 10) : 0;
}

async function finalizeVerdict(claim, verdict, ver) {
  const extra = {
    status: verdict, label: verdict === 'APPROVED' ? 'APPROVE' : 'REJECT',
    verdict, verdict_at: new Date().toISOString(),
    match: verdict === 'APPROVED'
  };
  if (ver && ver.actualBet != null) extra.actual_bet = ver.actualBet;
  if (ver && ver.actualScatter != null) extra.actual_scatter = ver.actualScatter;
  await sbClaimPatch(claim.id, extra, claim.status === 'SESUAI' ? 'SESUAI' : claim.status === 'VERIFYING' ? 'VERIFYING' : null);
}

async function processClaim(claim, admin, siteCfg) {
  if (!admin) {
    await sbClaimPatch(claim.id, {
      status: 'NO_TOKEN', label: 'BUTUH SESI ADMIN',
      detail: 'Paste X-Access-Token situs ini di halaman Worker (Sesi Admin).'
    }, claim.status === 'VERIFYING' ? 'VERIFYING' : claim.status === 'PENDING' ? 'PENDING' : null);
    return 'NO_TOKEN';
  }
  if (admin.expired) {
    await sbClaimPatch(claim.id, {
      status: 'NO_TOKEN', label: 'SESI ADMIN KADALUARSA',
      detail: 'X-Access-Token sudah expired — paste token baru di halaman Worker (Sesi Admin).'
    }, claim.status === 'VERIFYING' ? 'VERIFYING' : null);
    return 'EXPIRED';
  }
  const ver = await C.verifyClaim({ base: admin.base, headers: admin.headers, claim, apiHost: C.historyApiFor(admin.base) });
  if (ver.sessionInvalid) {
    await sbClaimPatch(claim.id, {
      status: 'NO_TOKEN', label: 'SESI ADMIN KADALUARSA', detail: String(ver.lastErr || '').slice(0, 300)
    }, claim.status === 'VERIFYING' ? 'VERIFYING' : null);
    return 'EXPIRED';
  }
  const cmp = C.compareClaim(claim, ver);

  if (ver.gameMismatch) {
    await finalizeVerdict(claim, 'REJECTED', ver);
    await sbClaimPatch(claim.id, {
      label: 'TIDAK SESUAI', match: false,
      detail: '[' + admin.host + '] ' + (ver.lastErr || cmp.reasons.join('; '))
    }, null);
    return 'REJECTED';
  }

  if (!cmp.match) {
    if (ver.records.length === 0) {
      const age = Date.now() - new Date(claim.created_at || Date.now()).getTime();
      const tries = retryCount(claim.detail, 'cekr');
      if (age < 5 * 60000 && tries < 4) {
        await sbClaimPatch(claim.id, {
          status: 'PENDING', label: 'TUNGGU DATA',
          detail: 'cekr=' + (tries + 1) + ' history kosong — dicek ulang #' + claim.claim_no + ' (' + admin.host + ')'
        }, claim.status === 'VERIFYING' ? 'VERIFYING' : null);
        return 'RETRY';
      }
      await sbClaimPatch(claim.id, {
        status: 'CEK_KOSONG', label: 'HISTORY KOSONG',
        detail: admin.host + ' tidak mengembalikan record utk ' + claim.user_id + ' (periksa sesi/host; atau user belum punya history).'
          + (ver.lastErr ? ' — ' + String(ver.lastErr).slice(0, 120) + scaterTag(ver.lastErr) : '')
      }, claim.status === 'VERIFYING' ? 'VERIFYING' : null);
      return 'EMPTY';
    }
    if (ver.matched && (ver.actualScatter === null || ver.actualScatter === undefined) && ver.lastErr) {
      const tries = retryCount(claim.detail, 'scr');
      if (tries < 4) {
        await sbClaimPatch(claim.id, {
          status: 'PENDING', label: 'TUNGGU SCATTER',
          detail: 'scr=' + (tries + 1) + ' GetBetHistory belum siap: ' + String(ver.lastErr).slice(0, 200) + scaterTag(ver.lastErr)
        }, claim.status === 'VERIFYING' ? 'VERIFYING' : null);
        return 'RETRY';
      }
    }
    await finalizeVerdict(claim, 'REJECTED', ver);
    await sbClaimPatch(claim.id, {
      status: 'REJECTED', label: 'TIDAK SESUAI', match: false,
      detail: '[' + admin.host + '] ' + cmp.reasons.join('; ')
    }, null);
    return 'REJECTED';
  }

  await sbClaimPatchNew(claim.id, {
    status: 'SESUAI', label: 'ALIGN', match: true,
    actual_bet: ver.actualBet, actual_scatter: ver.actualScatter,
    hadiah: S.calcHadiah(claim.betting, claim.scatter) || null
  }, claim.status === 'VERIFYING' ? 'VERIFYING' : null);

  if (ver.verdict === 'APPROVED' || ver.verdict === 'REJECTED') {
    await finalizeVerdict(claim, ver.verdict, ver);
    return ver.verdict;
  }
  return 'SESUAI';
}

/* Pass 2: klaim SESUAI (belum ada verdict) → polling status dr admin. */
async function pollSesuai(claim, admin) {
  if (!admin || admin.expired) return;
  try {
    const v = await C.fetchVerdict(admin.base, admin.headers, claim);
    if (v) {
      await sbClaimPatch(claim.id, {
        status: v, label: v === 'APPROVED' ? 'APPROVE' : 'REJECT',
        verdict: v, verdict_at: new Date().toISOString(), match: v === 'APPROVED'
      }, 'SESUAI');
    }
  } catch (e) { /* besok di-coba lagi */ }
}

/* ============ Fase B: INPUT bonus via template (payload.bonus_submit) ============ */
/* Port alur isi-form AUTO RELAX ke HTTP: bangun payload+request dari template
   config, kirim, klasifikasi respons → jangkar kolom secure_status/secure_detail. */
async function inputBonus(claim, admin, submitCfg, requireInput) {
  if (!submitCfg && !requireInput) return 'SKIP';
  const guardOf = () => claim.status === 'SESUAI' ? 'SESUAI' : claim.status === 'INPUTTING' ? 'INPUTTING' : null;

  if (!submitCfg) {
    await sbClaimPatchNew(claim.id, {
      status: 'INPUTTING', label: 'BUTUH ENDPOINT INPUT',
      detail: 'Atur payload.bonus_submit di panel Worker (lihat docs).'
    }, guardOf());
    return 'INPUTTING';
  }
  if (!admin) {
    await sbClaimPatch(claim.id, {
      status: 'NO_TOKEN', label: 'BUTUH SESI ADMIN',
      detail: 'Paste X-Access-Token situs ini di halaman Worker (Sesi Admin) — INPUT bonus tidak bisa jalan.'
    }, guardOf());
    return 'NO_TOKEN';
  }
  if (admin.expired) {
    await sbClaimPatch(claim.id, {
      status: 'NO_TOKEN', label: 'SESI ADMIN KADALUARSA',
      detail: 'X-Access-Token sudah expired — paste token baru di halaman Worker (Sesi Admin) untuk INPUT bonus.'
    }, guardOf());
    return 'EXPIRED';
  }
  if (!submitCfg.url || String(submitCfg.url).indexOf('{{') < 0) {
    await sbClaimPatchNew(claim.id, {
      status: 'INPUT_FAIL', label: 'INPUT GAGAL',
      detail: 'inputerr=1 payload.bonus_submit.url kosong/ tanpa {{placeholder}} — isi template di panel Worker.'
    }, guardOf());
    return 'INPUT_FAIL';
  }

  const maxRetry = /^\d+$/.test(String(submitCfg.max_retry)) ? parseInt(submitCfg.max_retry, 10) : 3;
  const row = R.toClaimRow(claim);
  const payload = R.buildBonusPayload(row, submitCfg);
  const req = R.buildSubmitRequest(payload, submitCfg, (admin && admin.headers) || {});

  let tries = 0;
  let lastCls = 'UNKNOWN';
  let lastMsg = '';
  for (; tries <= maxRetry; tries++) {
    try {
      const r = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
      const text = await r.text();
      lastMsg = text || '';
      const cls = R.classifySecureStatus(text || String(r.status));
      lastCls = r.ok ? cls : (cls === 'OK' ? 'UNKNOWN' : cls);
      if (lastCls === 'GAGAL') throw new Error('secure=gagal ' + String(text).slice(0, 200));
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + String(text).slice(0, 200));
      await sbClaimPatchNew(claim.id, {
        status: 'INPUT_OK', label: 'INPUT OK',
        detail: 'input=ok url=' + String(req.url).slice(0, 140),
        secure_status: lastCls, secure_detail: String(text || '').slice(0, 400)
      }, guardOf());
      return 'INPUT_OK';
    } catch (e) {
      lastMsg = String(e && e.message || e);
      if (lastCls !== 'GAGAL') lastCls = 'UNKNOWN';
    }
  }

  if (lastCls === 'GAGAL') {
    await sbClaimPatchNew(claim.id, {
      status: 'INPUT_FAIL', label: 'INPUT GAGAL',
      detail: String(lastMsg).slice(0, 300),
      secure_status: 'GAGAL', secure_detail: String(lastMsg).slice(0, 400)
    }, guardOf());
  } else {
    await sbClaimPatchNew(claim.id, {
      status: 'INPUT_FAIL', label: 'INPUT FAIL',
      detail: 'inputerr=' + tries + ' ' + String(lastMsg).slice(0, 200)
    }, guardOf());
  }
  return 'INPUT_FAIL';
}

/* ============ Fase C: poll verdict (payload.verdict_poll / history admin) ============ */
async function pollVerdict(claim, admin, verdictPoll) {
  if (!verdictPoll) return 'SKIP';
  const guard = claim.status === 'INPUT_OK' ? 'INPUT_OK' : claim.status === 'SESUAI' ? 'SESUAI' : null;
  const stamp = new Date().toISOString();
  try {
    let v = '';
    const pv = typeof verdictPoll === 'string' ? { url: verdictPoll, method: 'GET', headers: {} } : (verdictPoll || {});
    if (pv.url && typeof pv.url === 'string' && pv.url.indexOf('{{') >= 0) {
      const finalUrl = R.templateFill(pv.url, {
        kode: claim.kode_tiket, kodeTiket: claim.kode_tiket, site: claim.site,
        userId: claim.user_id, user: claim.user_id,
        betting: claim.betting, scatter: claim.scatter,
        bonusToken: (admin && admin.headers && admin.headers['X-Access-Token']) || ''
      });
      const r = await fetch(finalUrl || pv.url, {
        method: String(pv.method || 'GET').toUpperCase(),
        headers: (pv.headers && typeof pv.headers === 'object') ? pv.headers : {}
      });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* teks biasa */ }
      v = R.classifyHistoryStatus(json !== null ? json : text);
    } else if (admin && admin.base) {
      v = await C.fetchVerdict(admin.base, admin.headers, claim) || '';
    }
    if (v === 'APPROVED' || v === 'REJECTED') {
      await finalizeVerdict(claim, v, {});
      await sbClaimPatchNew(claim.id, { detail: 'last_polled_at=' + stamp }, guard);
      return v;
    }
    await sbClaimPatchNew(claim.id, { detail: 'last_polled_at=' + stamp + ' poll=belum-ada-verdict' }, guard);
    return 'POLLING';
  } catch (e) {
    return 'SKIP';
  }
}

async function handleProcess(req, res) {
  if (!L.SB_SVC && !L.SB_KEY) return L.fail(res, 'Supabase key belum diatur di Vercel.');
  if (String(req.headers['x-vercel-cron'] || '').trim() !== '1') {
    const acct = await L.requireAccount(req, res, 'approve');
    if (!acct) return;
  }
  const summary = { scanned: 0, locked: 0, settled: 0, retried: 0, errors: 0, tokens: 0, inputs: 0, verdicts: 0, polled: 0 };
  try {
    const { sites, bonusDomain, submitCfg, requireInput, verdictPoll } = await (async () => {
      let payload = null;
      try {
        const c = await L.sbGet('worker_config', 'select=payload&id=eq.1', sbAdmKey());
        payload = (Array.isArray(c) && c[0] && c[0].payload) || null;
      } catch (e) {}
      const p = payload && typeof payload === 'object' ? payload : {};
      const sites = Array.isArray(p.sites) && p.sites.length ? p.sites
        : [{ siteId: 'bandar80', gameId: '74', historyHost: 'bandar80.idrbo2.com', apiHost: 'bandar80.idrbo2.com' }];
      const submitCfg = (p.bonus_submit && typeof p.bonus_submit === 'object') ? p.bonus_submit : null;
      const verdictPoll = (p.verdict_poll && typeof p.verdict_poll === 'object') ? p.verdict_poll
        : (typeof p.verdict_poll === 'string' && p.verdict_poll) ? String(p.verdict_poll) : null;
      return {
        sites, bonusDomain: String(p.bonus_domain || p.bonusDomain || 'bonussmb.com').trim(),
        submitCfg, requireInput: !!p.require_input, verdictPoll
      };
    })();

    const tokRows = await sbRows('worker_tokens', 'select=host,base,headers,captured_at&order=captured_at.desc&limit=300');
    const bestByHost = new Map();
    for (const r of tokRows || []) {
      if (!r || !r.host) continue;
      const prev = bestByHost.get(r.host);
      if (!prev || String(prev.captured_at || '') < String(r.captured_at || '')) bestByHost.set(r.host, r);
    }
    summary.tokens = bestByHost.size;

    await claimsInfo();
    const claims = await sbRows('claims',
      'select=id,claim_no,site,user_id,kode_tiket,betting,scatter,status,label,detail,created_at,updated_at&status=in.(PENDING,SESUAI,INPUTTING,INPUT_OK)&order=created_at.asc&limit=12');

    const siteCfgBySiteId = new Map();
    for (const s of sites || []) {
      if (!s || typeof s !== 'object') continue;
      const pick = (name) => {
        if (s[name] !== undefined && s[name] !== null) return s[name];
        const ln = name.toLowerCase();
        for (const k of Object.keys(s)) {
          if (k.toLowerCase() === ln) return s[k];
        }
        return undefined;
      };
      const siteId = pick('siteId');
      if (!siteId) continue;
      siteCfgBySiteId.set(String(siteId).toLowerCase(), {
        siteId,
        label: pick('label'),
        host: pick('host'),
        historyHost: pick('historyHost'),
        apiHost: pick('apiHost'),
        gameId: pick('gameId'),
        active: pick('active')
      });
    }

    const start = Date.now();
    for (const claim of claims || []) {
      try {
        if (Date.now() - start > PROCESS_BUDGET_MS) break;
        summary.scanned++;
        const admin = await findAdminFor(claim, bestByHost, sites, bonusDomain);

        if (claim.status === 'SESUAI') {
          if (submitCfg || requireInput) {
            summary.inputs++;
            const b = await inputBonus(claim, admin, submitCfg, requireInput);
            if (b === 'INPUT_OK' && verdictPoll) await pollVerdict(claim, admin, verdictPoll);
          } else {
            const updated = claim.updated_at ? Date.now() - new Date(claim.updated_at).getTime() : Number.MAX_SAFE_INTEGER;
            if (updated > 15000) await pollSesuai(claim, admin);
          }
          continue;
        }

        if (claim.status === 'INPUTTING') {
          summary.inputs++;
          const b = await inputBonus(claim, admin, submitCfg, requireInput);
          if (b === 'INPUT_OK' && verdictPoll) await pollVerdict(claim, admin, verdictPoll);
          continue;
        }

        if (claim.status === 'INPUT_OK') {
          if (!verdictPoll) continue;
          const v = await pollVerdict(claim, admin, verdictPoll);
          if (v === 'APPROVED' || v === 'REJECTED') summary.verdicts++; else summary.polled++;
          continue;
        }

        /* kunci antrean: hanya ambil yg masih PENDING (cek status=eq.PENDING) */
        const locked = await sbClaimPatch(claim.id, {
          status: 'VERIFYING', label: 'CEK', detail: 'diproses server (web-only)'
        }, 'PENDING');
        if (!Array.isArray(locked) || locked.length === 0) continue;
        summary.locked++;
        const r = await processClaim(claim, admin, siteCfgBySiteId.get(String(claim.site || '').toLowerCase()));
        if (r === 'RETRY') summary.retried++; else summary.settled++;
      } catch (e) {
        summary.errors++;
        await sbClaimPatch(claim.id, {
          status: 'ERROR', label: 'ERROR', detail: String(e.message || e).slice(0, 300)
        }).catch(() => {});
      }
    }
    return L.ok(res, { ok: true, summary }, { 'Cache-Control': 'no-store' });
  } catch (e) {
    return L.fail(res, 'Proses gagal: ' + String(e.message || e));
  }
}

/* ============ Endpoint PUBLIK (muat dalam 1 fungsi utk kuota Hobby) ============ */
const PUB_SITE_RE = /^[a-z0-9_]{1,40}$/;
const PUB_TX_RE = /^[0-9]{1,40}$/;
const PUB_MONEY_MIN = 1600, PUB_MONEY_MAX = 1000000;
const PUB_SCATTER_ALLOWED = [3, 4, 5];

async function publicSbCount(path, qs) {
  const res = await fetch(L.SB_URL + '/rest/v1/' + path + '?select=id&' + qs, { headers: L.sbh('count=exact') });
  if (!res.ok) throw new Error('DB ' + res.status);
  await res.text();
  const m = /^.*\/(\d+|\*)$/.exec(res.headers.get('content-range') || '');
  return m ? parseInt(m[1], 10) : -1;
}

async function publicInsertRep(table, row) {
  const res = await fetch(L.SB_URL + '/rest/v1/' + table, {
    method: 'POST', headers: L.sbh('return=representation', L.SB_KEY), body: JSON.stringify(row)
  });
  const t = await res.text();
  if (!res.ok) { const e = new Error(t || ('DB ' + res.status)); e.status = res.status; e.bodyText = t || ''; throw e; }
  const j = t ? JSON.parse(t) : [];
  return Array.isArray(j) ? (j[0] || null) : j;
}

function publicFriendlyInsertError(err) {
  const s = String(err.bodyText || err.message || '');
  if (/maksimal 2 klaim per user id per hari/i.test(s)) {
    return { code: 'LIMIT_DAILY', message: 'Anda sudah 2 kali claim hari ini. Coba kembali setelah ganti hari.' };
  }
  if (/pengajuan klaim dibuka/i.test(s)) {
    return { code: 'SVC_HOURS', message: 'Pendaftaran klaim dibuka 00.00 s/d 23.50 WIB. Coba kembali setelah ganti hari.' };
  }
  if (/betting\s*>\s*0|check constraint/i.test(s)) {
    return { code: 'BET_INVALID', message: 'Nominal bet tidak valid.' };
  }
  return { code: 'DB_INSERT', message: 'Klaim sedang ramai, coba beberapa saat lagi.' };
}

let publicSitesCache = null, publicSitesAt = 0;
async function publicActiveSites() {
  const now = Date.now();
  if (publicSitesCache && now - publicSitesAt < 60000) return publicSitesCache;
  const rows = await L.sbGet('sites', 'select=site_id,label,active');
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => { map[r.site_id] = { label: r.label, active: !!r.active }; });
  publicSitesCache = map; publicSitesAt = now;
  return map;
}

async function handlePublicSubmit(req, res) {
  if (req.method !== 'POST') return L.methodNotAllowed(res);
  if (req.headers['content-type'] && req.headers['content-type'].indexOf('application/json') < 0) {
    return L.bad(res, 'BAD_TYPE', 'Format data tidak didukung.');
  }
  const ip = L.clientIp(req);
  if (!L.originOk(req)) return L.denied(res);
  let rl = L.rateLimit(ip, 60000, 8);
  if (!rl.ok) return L.send(res, 429, { ok: false, code: 'RATE', message: 'Terlalu sering. Coba sebentar lagi.' });

  let body;
  try { body = await L.readBody(req, 32 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data klaim tidak terbaca.'); }
  if (!body || typeof body !== 'object') return L.bad(res, 'BAD_BODY', 'Data klaim tidak terbaca.');

  if ((body.website && String(body.website).trim()) || (body.company && String(body.company).trim())) {
    return L.ok(res, { ok: true, faked: true });
  }
  if (typeof body.t !== 'number' || Date.now() - body.t < 2500) {
    return L.bad(res, 'TOO_FAST', 'Mohon tunggu beberapa detik sebelum mengirim.');
  }

  const site = String(body.site || '').trim().slice(0, 40);
  const userId = String(body.user_id || '').trim().slice(0, 64);
  const tx = String(body.kode_tiket || '').trim().slice(0, 40);
  const betRaw = String(body.betting || '').replace(/[^\d]/g, '').slice(0, 12);
  const scatter = Number(body.scatter);

  if (!PUB_SITE_RE.test(site)) return L.bad(res, 'BAD_SITE', 'Pilih situs tujuan yang valid.');
  if (!userId || userId.length < 2) return L.bad(res, 'BAD_USER', 'User ID tidak valid.');
  if (!PUB_TX_RE.test(tx) || tx.length < 6) return L.bad(res, 'BAD_TX', 'Kode tiket tidak valid.');
  const betting = parseInt(betRaw, 10);
  if (!betting || betting < PUB_MONEY_MIN || betting > PUB_MONEY_MAX) {
    return L.bad(res, 'BAD_BET', 'Nominal bet harus antara Rp 1.600 dan Rp 1.000.000.');
  }
  if (PUB_SCATTER_ALLOWED.indexOf(scatter) < 0) return L.bad(res, 'BAD_SC', 'Jumlah scatter tidak valid.');

  try {
    const sites = await publicActiveSites();
    if (!sites[site] || !sites[site].active) return L.bad(res, 'SITE_OFF', 'Situs tujuan sedang dinonaktifkan.');

    const from = L.iso(L.wibDayStartMs());
    const cnt = await publicSbCount('claims',
      'user_id=eq.' + encodeURIComponent(userId) +
      '&created_at=gte.' + encodeURIComponent(from) +
      '&created_at=lt.' + encodeURIComponent(new Date(Date.now() + 1000).toISOString()));
    if (cnt !== -1 && cnt >= 2) {
      return L.bad(res, 'LIMIT_DAILY', 'Anda sudah 2 kali claim hari ini. Coba kembali setelah ganti hari.');
    }

    const row = await publicInsertRep('claims', { site, user_id: userId, kode_tiket: tx, betting, scatter });
    return L.ok(res, { ok: true, row: row ? { id: row.id, status: row.status } : null });
  } catch (e) {
    if (e && (e.status || e.bodyText)) {
      const fr = publicFriendlyInsertError(e);
      return L.bad(res, fr.code, fr.message);
    }
    return L.fail(res, 'Gagal menghubungi penyimpanan.');
  }
}

async function handlePublicSitelist(req, res) {
  if (req.method !== 'GET') return L.methodNotAllowed(res);
  let rl = L.rateLimit(L.clientIp(req), 60000, 120);
  if (!rl.ok) return L.send(res, 429, { ok: false, code: 'RATE', message: 'Terlalu sering.' });
  try {
    const sites = await publicActiveSites();
    const out = Object.keys(sites)
      .filter((k) => sites[k].active)
      .map((k) => ({ site_id: k, label: sites[k].label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return L.ok(res, { ok: true, sites: out });
  } catch (e) {
    return L.fail(res, 'Gagal mengambil daftar situs.');
  }
}

async function handlePublicTrack(req, res) {
  if (req.method !== 'GET') return L.methodNotAllowed(res);
  const ip = L.clientIp(req);
  let rl = L.rateLimit(ip, 60000, 60);
  if (!rl.ok) return L.send(res, 429, { ok: false, code: 'RATE', message: 'Terlalu sering. Coba sebentar lagi.' });
  const url = new URL(req.url, 'http://x');
  const userId = String(url.searchParams.get('user_id') || '').trim().slice(0, 64);
  if (!userId) return L.bad(res, 'BAD_USER', 'Isi User ID dulu.');
  try {
    const from = L.iso(L.wibDayStartMs());
    const used = await publicSbCount('claims',
      'user_id=eq.' + encodeURIComponent(userId) +
      '&created_at=gte.' + encodeURIComponent(from) +
      '&created_at=lt.' + encodeURIComponent(new Date(Date.now() + 1000).toISOString()));
    const rows = await L.sbGet('claims',
      'select=id,site,user_id,kode_tiket,betting,scatter,status,label,detail,created_at,updated_at' +
      '&user_id=eq.' + encodeURIComponent(userId) +
      '&order=created_at.desc&limit=20');
    return L.ok(res, { ok: true, used: used === -1 ? 0 : used, max: 2, rows: Array.isArray(rows) ? rows : [] });
  } catch (e) {
    return L.fail(res, 'Gagal menghubungi penyimpanan.');
  }
}

module.exports = async function (req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '');
  const isPost = req.method === 'POST' || req.method === 'PUT';

  if (p === '/api/submit') return handlePublicSubmit(req, res);
  if (p === '/api/sitelist') return handlePublicSitelist(req, res);
  if (p === '/api/track') return handlePublicTrack(req, res);

  if (p.endsWith('/tokens')) {
    const need = req.method === 'DELETE' ? 'hapus' : (req.method === 'POST' || req.method === 'PUT' ? 'approve' : 'pantau');
    const acct = await L.requireAccount(req, res, need);
    if (!acct) return;
    try {
      if (req.method === 'POST' || req.method === 'PUT') return await handleTokenSave(req, res);
      return await handleTokens(req, res);
    } catch (e) { return L.fail(res, 'Gagal ambil token worker.'); }
  }

  if (p.endsWith('/process')) {
    try { return await handleProcess(req, res); }
    catch (e) { return L.fail(res, 'Gagal proses claims: ' + String(e.message || e)); }
  }

  const acct = await (p.endsWith('/config') || p.endsWith('/command') ? L.requireAccount(req, res, 'approve') : L.requireAccount(req, res, 'pantau'));
  if (!acct) return;

  if (p === '/api/worker' || p === '/api/worker/') {
    return isPost ? handleConfig(req, res) : handleGet(res);
  }
  if (p.endsWith('/config')) return handleConfig(req, res);
  if (p.endsWith('/command')) return handleCommand(req, res);
  return L.ok(res, { ok: true, setup: false });
};