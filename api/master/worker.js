'use strict';
/* /api/worker → router tunggal (hemat lambda di Hobby: 1 fungsi, bukan 3).
   - GET  /api/worker             → status daemon + config + perintah terakhir (izin pantau)
   - POST /api/worker/config      → simpan parameter (izin approve)
   - POST /api/worker/command     → antrekan aksi utk daemon (izin approve)
   Jika tabel belum dibuat → setup=false (panel menampilkan petunjuk). */
const L = require('./_lib');

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

module.exports = async function (req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '');
  const isPost = req.method === 'POST' || req.method === 'PUT';

  const acct = await (p.endsWith('/config') || p.endsWith('/command') ? L.requireAccount(req, res, 'approve') : L.requireAccount(req, res, 'pantau'));
  if (!acct) return;

  if (p === '/api/worker' || p === '/api/worker/') {
    return isPost ? handleConfig(req, res) : handleGet(res);
  }
  if (p.endsWith('/config')) return handleConfig(req, res);
  if (p.endsWith('/command')) return handleCommand(req, res);
  return L.ok(res, { ok: true, setup: false });
};