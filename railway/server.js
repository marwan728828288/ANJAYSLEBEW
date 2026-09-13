'use strict';
/* ============================================================
   railway/server.js — Server Railway (selalu hidup) utk Bandar80.
   - Mount semua router Vercel (api/master/*) ke satu proses node:http
     (bukan serverless → tanpa cold start, tanpa batasan cron Hobby).
   - Loop background: jalankan /api/worker/process sendiri tiap
     POLL_INTERVAL_MS (tidak butuh cron Vercel / GitHub Actions ping).
   - Hooks /app/status, /app/bonus/* (Playwright opt-in).
   - Static: sajikan web/ (dashboard) agar same-origin (sesi + CORS aman).
   Konfigurasi via env (lihat README.md).
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 300000;
const SERVE_WEB = String(process.env.SERVE_WEB || 'true') === 'true';
const BONUS_ENABLED = String(process.env.RAILWAY_PLAYWRIGHT || 'false') === 'true';
const PIPELINE_ENABLED = String(process.env.RAILWAY_PIPELINE || 'true') === 'true';
const ALLOW_ORIGINS = String(process.env.ALLOW_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.replace(/\/$/, ''));

/* ---------- muat semua router Vercel api/master/* ---------- */
const BASE = path.join(__dirname, '..');
function load(rel) { return require(path.join(BASE, 'api', 'master', rel)); }

const R = {
  worker: load('worker'),
  health: load('health'),
  session: load('session'),
  auth: load('auth'),
  step1: load('auth/step1'),
  setup2fa: load('auth/setup2fa'),
  admin: load('admin'),
  staffCreate: load('staff/create'),
  staffList: load('staff/list'),
  staffLogin: load('staff/login'),
  staffLogout: load('staff/logout'),
  staffUpdate: load('staff/update')
};

const WEB_DIR = path.join(BASE, 'web');
const APP_ROUTES = {
  '/app/status': handleStatus,
  '/app/bonus/login': handleBonusLogin,
  '/app/bonus/click': handleBonusClick,
  '/app/bonus/state': handleBonusState
};

let bonusBot = null;
if (BONUS_ENABLED) {
  try {
    bonusBot = require('./bonus-bot');
    bonusBot.init().catch((e) => { /* server tetap jalan; login manual via /app/bonus/login */ });
  } catch (e) {
    console.log('bonus-bot tidak aktif: ' + String(e.message || e));
  }
}

/* ---------- helper ---------- */
function json(res, code, obj, extra) {
  res.statusCode = code;
  if (extra) for (const k in extra) res.setHeader(k, extra[k]);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
function fail(res, code, msg) { return json(res, code, { ok: false, code, message: msg }); }

/* izinkan origin di ALLOW_ORIGINS dengan membuang header Origin (originOk: tanpa origin = boleh).
   Juga izinkan * railway / vercel (sudah ditangani _lib originOk utk .vercel.app). */
function corsPass(req) {
  const o = String(req.headers['origin'] || '');
  if (!o) return;
  for (const a of ALLOW_ORIGINS) {
    if (o === a || o.startsWith(a + '/')) { delete req.headers.origin; return; }
  }
}

/* ---------- pemetaan path → handler (mirror routing implisit Vercel) ---------- */
function resolveApi(pathname) {
  const p = pathname;
  if (p === '/api/health') return R.health;
  if (p === '/api/session') return R.session;
  if (p === '/api/admin') return R.admin;
  if (p === '/api/auth/step1') return R.step1;
  if (p === '/api/auth/setup2fa') return R.setup2fa;
  if (p === '/api/auth') return R.auth;
  if (p === '/api/staff/create') return R.staffCreate;
  if (p === '/api/staff/list') return R.staffList;
  if (p === '/api/staff/login') return R.staffLogin;
  if (p === '/api/staff/logout') return R.staffLogout;
  if (p === '/api/staff/update') return R.staffUpdate;
  if (p === '/api/submit' || p === '/api/sitelist' || p === '/api/track') return R.worker;
  if (p === '/api/worker' || p.indexOf('/api/worker/') === 0) return R.worker;
  return null;
}

/* ---------- static web/ ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm'
};
function serveStatic(req, res, p) {
  if (!SERVE_WEB) return fail(res, 404, 'not_found');
  let rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  if (p === '/admin' || p === '/master') rel = 'master.html';
  if (p === '/dashboard') rel = 'dashboard.html';
  const full = path.join(WEB_DIR, rel);
  if (path.normalize(full).indexOf(path.normalize(WEB_DIR)) !== 0) return fail(res, 403, 'forbidden');
  fs.readFile(full, (err, buf) => {
    if (err) {
      if (p !== '/master.html') {
        const alt = path.join(WEB_DIR, 'master.html');
        return fs.readFile(alt, (e2, b2) => {
          if (e2) return fail(res, 404, 'not_found');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end(b2);
        });
      }
      return fail(res, 404, 'not_found');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', /\.(js|css|png|jpg|wasm|woff2)/.test(full) ? 'public, max-age=3600' : 'no-store');
    res.end(buf);
  });
}

/* ---------- hook bonus-bot (Playwright) ---------- */
async function handleBonusLogin(req, res) {
  if (!bonusBot) return fail(res, 400, 'RAILWAY_PLAYWRIGHT=false (bonus-bot nonaktif).');
  let body = {};
  try { body = await readBody(req, 64 * 1024); } catch (e) { body = {}; }
  try {
    const r = await bonusBot.login(body.url || process.env.BONUS_SITE_URL);
    return json(res, 200, { ok: true, ...r });
  } catch (e) { return fail(res, 500, 'Bonus login gagal: ' + String(e.message || e)); }
}
async function handleBonusClick(req, res) {
  if (!bonusBot) return fail(res, 400, 'RAILWAY_PLAYWRIGHT=false (bonus-bot nonaktif).');
  let body = {};
  try { body = await readBody(req, 64 * 1024); } catch (e) { body = {}; }
  const kode = String(body.kode || body.kode_tiket || '').trim();
  const action = String(body.action || '').toUpperCase();
  if (!kode) return fail(res, 400, 'kode kosong.');
  if (action !== 'APPROVE' && action !== 'REJECT') return fail(res, 400, 'action harus APPROVE/REJECT.');
  try {
    const r = await bonusBot.click(kode, action, body);
    return json(res, 200, { ok: true, ...r });
  } catch (e) { return fail(res, 500, 'Bonus click gagal: ' + String(e.message || e)); }
}
async function handleBonusState(req, res) {
  if (!bonusBot) return fail(res, 400, 'RAILWAY_PLAYWRIGHT=false (bonus-bot nonaktif).');
  return json(res, 200, { ok: true, state: bonusBot.state() });
}

/* ---------- baca body JSON ---------- */
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > max) { reject(new Error('too big')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

/* ---------- dispatcher utama ---------- */
async function onRequest(req, res) {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { return fail(res, 400, 'bad url'); }
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (APP_ROUTES[p]) {
    try { return await APP_ROUTES[p](req, res); } catch (e) { return fail(res, 500, String(e.message || e)); }
  }
  if (p.indexOf('/api/') === 0) {
    corsPass(req);
    const fn = resolveApi(p);
    if (!fn) return fail(res, 404, 'api_not_found');
    try { return await fn(req, res); }
    catch (e) {
      console.log('api error ' + p + ': ' + String(e.message || e));
      return fail(res, 500, 'api_error');
    }
  }
  return serveStatic(req, res, p || '/');
}

/* ---------- loop background pipeline 3 fase ---------- */
const state = { uptime: Date.now(), loopRunning: false, lastRun: null, lastPipeline: null };
function httpRaw(pathname, headers) {
  return new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'POST', headers }, (rs) => {
      let t = '';
      rs.on('data', (c) => { t += c; if (t.length > 4096) rs.destroy(); });
      rs.on('end', () => resolve({ status: rs.statusCode, ok: rs.statusCode < 400, text: t.slice(0, 500) }));
    });
    rq.on('error', (e) => resolve({ status: 0, ok: false, text: String(e.message) }));
    rq.end();
  });
}
async function runPipeline() {
  if (state.loopRunning) return;
  state.loopRunning = true;
  const t0 = Date.now();
  try {
    const r = await httpRaw('/api/worker/process', { 'x-vercel-cron': '1' });
    state.lastPipeline = { at: new Date().toISOString(), ms: Date.now() - t0, ok: r.ok, status: r.status, body: r.text };
  } catch (e) {
    state.lastPipeline = { at: new Date().toISOString(), ms: Date.now() - t0, ok: false, error: String(e.message || e) };
  } finally {
    state.loopRunning = false;
    if (state.lastPipeline) state.lastRun = new Date().toISOString();
  }
}
async function handleStatus(req, res) {
  return json(res, 200, {
    ok: true, pid: process.pid, uptimeMs: Date.now() - state.uptime,
    loop: { enabled: true, intervalMs: POLL_MS, running: state.loopRunning, lastRun: state.lastRun, last: state.lastPipeline },
    bonus: { enabled: BONUS_ENABLED, active: !!bonusBot, bonusBot: bonusBot ? bonusBot.state() : null },
    server: { port: PORT, serveWeb: SERVE_WEB }
  });
}

http.createServer(onRequest).listen(PORT, () => {
  console.log('railway server :' + PORT + ' (poll=' + POLL_MS + 'ms, web=' + SERVE_WEB + ', bonus=' + BONUS_ENABLED + ', pipeline=' + PIPELINE_ENABLED + ')');
  if (!PIPELINE_ENABLED) return;
  runPipeline();
  setInterval(runPipeline, POLL_MS).unref();
});