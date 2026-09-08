'use strict';
/* ============================================================
   BANDAR80 — api/master/_lib.js
   Helper bersama fungsi serverless Vercel di situs MASTER (terpisah).
   Termasuk: autentikasi PIN + token HMAC, akses admin ke Supabase.
   ============================================================ */

const crypto = require('crypto');

const SB_URL  = process.env.SUPABASE_URL || 'https://epzuvadrnzdnyyhwiqyc.supabase.co';
const SB_KEY  = process.env.SUPABASE_KEY || 'sb_publishable_4GtsLX1vvVcyfyFnL91JwQ_DLh_jvjP';
const SB_SVC  = process.env.SUPABASE_SERVICE_KEY || '';   // opsional: akses penuh admin
const OW_SECRET = process.env.OWNER_SECRET || '';          // wajib diisikan di Vercel
const OW_PIN    = process.env.OWNER_PIN || '';             // PIN login owner
const OW_TOTP   = process.env.OWNER_TOTP_SECRET || '';     // base32 secret utk 2FA (RFC 6238)
const TOKEN_TTL = 12 * 3600 * 1000;                        // 12 jam
const STAGE_TTL = 5 * 60 * 1000;                           // tahap-A (kredensial terverifikasi): 5 mnt
const STAFF_TTL = 6 * 3600 * 1000;                         // sesi staff: 6 jam
const OW_USER   = process.env.OWNER_USERNAME || '';        // username/password pemilik (tahap 1)
const OW_PASS   = process.env.OWNER_PASSWORD || '';
const GOOGLE_CID  = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CSEC = process.env.GOOGLE_CLIENT_SECRET || '';
const OW_GOOGLE   = process.env.OWNER_GOOGLE_EMAIL || '';  // email Google pemilik yg diizinkan

/* peran & izin fitur staff (owner otomatis punya semua) */
const PERMS = ['ringkas', 'datalaim', 'approve', 'hapus', 'pantau', 'staff'];
const ROLE_DEF = {
  ADMIN: PERMS,
  CS: ['ringkas', 'datalaim', 'approve', 'pantau'],
  VERIFIKATOR: ['datalaim', 'approve'],
  KURIR: ['datalaim']
};

const WIB_MS = 7 * 3600 * 1000;

/* ---------- respons ---------- */
function send(res, code, obj, extra) {
  res.statusCode = code;
  if (extra) for (const k in extra) res.setHeader(k, extra[k]);
  if (code >= 400) res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
const ok     = (res, obj, extra) => send(res, 200, obj, extra);
const denied = (res) => send(res, 403, { ok: false, code: 'FORBIDDEN', message: 'Akses ditolak.' });
const unauth = (res) => send(res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'Sesi berakhir. Login ulang.' });
function bad(res, code, message) { send(res, 400, { ok: false, code, message }); }
function fail(res, message) { send(res, 500, { ok: false, code: 'SERVER', message: message || 'Gangguan server.' }); }
function methodNotAllowed(res) { send(res, 405, { ok: false, code: 'METHOD', message: 'Metode tidak didukung.' }); }

/* ---------- body ---------- */
function readBody(req, maxBytes) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > maxBytes) { reject(new Error('PAYLOAD_TOO_BIG')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });
}

/* ---------- IP, origin, rate ---------- */
function clientIp(req) {
  const x = req.headers['x-forwarded-for'];
  if (x) return String(x).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '?';
}
function originOk(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const o = String(req.headers['origin'] || '').toLowerCase();
  if (!o) return true;
  try {
    const u = new URL(o);
    return u.hostname === host || u.hostname.endsWith('.vercel.app');
  } catch (e) { return false; }
}
const buckets = new Map();
function rateLimit(ip, winMs, max) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now > b.reset) { b = { n: 0, reset: now + winMs }; buckets.set(ip, b); }
  if (buckets.size > 20000) {
    for (const [key, val] of buckets) if (now > val.reset) buckets.delete(key);
  }
  b.n++;
  return { ok: b.n <= max, n: b.n, retryAfterMs: Math.max(0, b.reset - now) };
}

/* ---------- token owner (HMAC-SHA256, ikat ke IP + sidik browser) ---------- */
function uaHash(ua) { return ua ? hmac('ua:' + ua).slice(0, 16) : ''; }
function hmac(payload) {
  return crypto.createHmac('sha256', OW_SECRET).update(payload).digest('hex');
}
function ipHex(ip) { return Buffer.from(String(ip), 'utf8').toString('hex'); }
function signSession(ip, ua) {
  const exp = Date.now() + TOKEN_TTL;
  const core = exp + '_' + ipHex(ip) + '_' + uaHash(ua);
  return core + '_' + hmac(core);   // delimiter '_' saja (IP berformat titik/colon aman)
}
function verifySession(token, ip, ua) {
  if (!token || !OW_SECRET) return null;
  const parts = String(token).split('_');
  if (parts.length !== 4) return null;
  const core = parts[0] + '_' + parts[1] + '_' + parts[2];
  const exp = parseInt(parts[0], 10);
  if (!exp || Date.now() > exp) return null;
  const expect = hmac(core);
  const a = Buffer.from(parts[3]);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  const bindIp = Buffer.from(parts[1], 'hex').toString('utf8');
  const bindUa = parts[2];
  if (bindIp && ip && bindIp !== ip) return null;          // token dikunci ke IP
  if (bindUa && ua && bindUa !== uaHash(ua)) return null;  // dan ke browser
  return { exp, ip: bindIp, ua: bindUa };
}
function readToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.indexOf('Bearer ') === 0) return h.slice(7).trim();
  const cookies = req.headers.cookie || '';
  const m = /(?:^|;\s*)owner_tok=([^;]+)/.exec(cookies);
  return m ? decodeURIComponent(m[1]) : '';
}
function readCookie(req, name) {
  const cookies = req.headers.cookie || '';
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(cookies);
  return m ? decodeURIComponent(m[1]) : '';
}

/* ---------- tahap-A: Google verified (sesi pendek, PIN+2FA belum ada) ---------- */
function b64u(s) { return Buffer.from(String(s), 'utf8').toString('base64url'); }
function unb64u(s) { try { return Buffer.from(String(s), 'base64url').toString('utf8'); } catch (e) { return ''; } }
function signStage(ip, ua, email) {
  const exp = Date.now() + STAGE_TTL;
  const core = 'S' + exp + '_' + ipHex(ip) + '_' + uaHash(ua) + '_' + b64u(email);
  return core + '_' + hmac(core);
}
function verifyStage(token, ip, ua) {
  if (!token || !OW_SECRET) return null;
  const parts = String(token).split('_');
  if (parts.length !== 5 || parts[0].charAt(0) !== 'S') return null;
  const exp = parseInt(parts[0].slice(1), 10);
  if (!exp || Date.now() > exp) return null;
  const core = parts[0] + '_' + parts[1] + '_' + parts[2] + '_' + parts[3];
  const a = Buffer.from(parts[4]); const b = Buffer.from(hmac(core));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const bindIp = Buffer.from(parts[1], 'hex').toString('utf8');
  const bindUa = parts[2];
  if (bindIp && ip && bindIp !== ip) return null;
  if (bindUa && ua && bindUa !== uaHash(ua)) return null;
  return { exp, ip: bindIp, ua: bindUa, email: unb64u(parts[3]) };
}
function googleConfigured() { return !!(GOOGLE_CID && GOOGLE_CSEC); }
function ownerStepConfigured() { return !!(OW_USER && OW_PASS); }
function userName() { return OW_USER; }
function masterPassOk(username, password) {
  if (!ownerStepConfigured()) return false;
  const a = Buffer.from(String(username).trim().toLowerCase());
  const b = Buffer.from(String(OW_USER).trim().toLowerCase());
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  if (OW_PASS.indexOf('sha256:') === 0) {
    const want = OW_PASS.slice(7);
    const got = crypto.createHash('sha256').update(String(password)).digest('hex');
    const x = Buffer.from(want); const y = Buffer.from(got);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
  const c = Buffer.from(String(password)); const d = Buffer.from(OW_PASS);
  return c.length === d.length && crypto.timingSafeEqual(c, d);
}

/* ---------- sesi staff (token HMAC, ikat IP + browser) ---------- */
function readStaffToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.indexOf('Bearer ') === 0) return h.slice(7).trim();
  return readCookie(req, 'staff_tok');
}
function signStaff(ip, ua, staffId) {
  const exp = Date.now() + STAFF_TTL;
  const core = exp + '_' + ipHex(ip) + '_' + uaHash(ua) + '_' + b64u('s:' + staffId);
  return core + '_' + hmac(core);
}
function verifyStaffToken(token, ip, ua) {
  if (!token || !OW_SECRET) return null;
  const parts = String(token).split('_');
  if (parts.length !== 5) return null;
  const exp = parseInt(parts[0], 10);
  if (!exp || Date.now() > exp) return null;
  const core = parts[0] + '_' + parts[1] + '_' + parts[2] + '_' + parts[3];
  const a = Buffer.from(parts[4]); const b = Buffer.from(hmac(core));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const bindIp = Buffer.from(parts[1], 'hex').toString('utf8');
  const bindUa = parts[2];
  if (bindIp && ip && bindIp !== ip) return null;
  if (bindUa && ua && bindUa !== uaHash(ua)) return null;
  const id = unb64u(parts[3]);
  return { exp, ip: bindIp, ua: bindUa, staffId: id.slice(2) };
}
function passHashSha(pw) {
  return 'sha256:' + crypto.createHash('sha256').update(String(pw)).digest('hex');
}
function passCheckSha(hash, pw) {
  if (!hash || String(hash).indexOf('sha256:') !== 0) return false;
  const want = hash.slice(7);
  const got = crypto.createHash('sha256').update(String(pw)).digest('hex');
  const a = Buffer.from(want); const b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const ALL_PERMS = PERMS.slice();

/* Akun: owner (semua izin) atau staff (izin per baris DB, dicek tiap request). */
async function loadStaffRow(id, key) {
  if (!SB_SVC) return null;
  const rows = await sbGet('staff', 'select=*&id=eq.' + encodeURIComponent(id), SB_SVC);
  return (Array.isArray(rows) && rows[0]) || null;
}
async function requireAccount(req, res, needed) {
  const ip = clientIp(req);
  const ua = String(req.headers['user-agent'] || '');
  const ownerTok = readToken(req);
  if (ownerTok && verifySession(ownerTok, ip, ua)) {
    return { kind: 'owner', perms: ALL_PERMS, staff: null, ip, ua };
  }
  if (!SB_SVC) { fail(res, 'Supabase service key belum diatur.'); return null; }
  const stok = readStaffToken(req);
  const sess = stok && verifyStaffToken(stok, ip, ua);
  if (!sess) { unauth(res); return null; }
  let row;
  try { row = await loadStaffRow(sess.staffId, SB_SVC); }
  catch (e) { fail(res, 'Gagal memuat akun staff.'); return null; }
  if (!row || row.active === false) { denied(res); return null; }
  const perms = Array.isArray(row.perms) ? row.perms : [];
  if (needed && perms.indexOf(needed) < 0) { denied(res); return null; }
  return { kind: 'staff', perms, staff: row, ip, ua };
}
function ownerOk() {
  return !!OW_PIN;
}

function pinMatches(pin) {
  if (!OW_PIN) return false;
  if (OW_PIN.indexOf('sha256:') === 0) {
    const want = OW_PIN.slice(7);
    const got = crypto.createHash('sha256').update(String(pin)).digest('hex');
    const a = Buffer.from(want); const b = Buffer.from(got);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const a = Buffer.from(String(OW_PIN)); const b = Buffer.from(String(pin));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- 2FA TOTP (RFC 6238, SHA1/6 digit/30 detik, toleransi ±1) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[\s=]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('base32 invalid');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpAt(counter, key) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter), 0);
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}
function verifyTotp(secretB32, code) {
  if (!secretB32 || !/^\d{6}$/.test(String(code))) return false;
  let key;
  try { key = base32Decode(secretB32); } catch (e) { return false; }
  const now = Math.floor(Date.now() / 30000);
  for (let w = -1; w <= 1; w++) {
    const got = Buffer.from(totpAt(now + w, key));
    const want = Buffer.from(String(code));
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return true;
  }
  return false;
}
function totpLocked() { return !OW_TOTP; }  // jika secret belum diatur → lewati 2FA (harus segera dipasang)

/* ---------- pemblokiran login gagal (5× / 15 mnt per IP) ---------- */
const failMap = new Map();
function loginGate(ip) {
  const now = Date.now();
  const f = failMap.get(ip);
  if (f && now < f.until) return { block: true, retryAfterMs: f.until - now };
  if (f && now >= f.until) failMap.delete(ip);
  return { block: false };
}
function loginFail(ip) {
  const now = Date.now();
  const f = failMap.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) { f.until = now + 15 * 60 * 1000; f.n = 0; failMap.set(ip, f); return { locked: true }; }
  failMap.set(ip, f);
  return { locked: false };
}
function loginOk(ip) { failMap.delete(ip); }

function requireOwner(req, res) {
  if (!ownerOk()) { denied(res); return null; }
  const ip = clientIp(req);
  const ua = String(req.headers['user-agent'] || '');
  const tok = readToken(req);
  if (!verifySession(tok, ip, ua)) { unauth(res); return null; }
  return { ip, ua };
}
/* ---------- WIB ---------- */
function wibDayStartMs() {
  return Date.parse(new Date(Date.now() + WIB_MS).toISOString().slice(0, 10) + 'T00:00:00Z') - WIB_MS;
}
function iso(ts) { return new Date(ts).toISOString(); }

/* ---------- Supabase REST (admin boleh pakai service key bila ada) ---------- */
function admKey() { return SB_SVC || SB_KEY; }
function sbh(prefer, key) {
  const k = key || admKey();
  const h = { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' };
  if (prefer) h.Prefer = prefer;
  return h;
}
async function sbGet(path, qs, key) {
  const res = await fetch(SB_URL + '/rest/v1/' + path + (qs ? '?' + qs : ''), { headers: sbh(null, key) });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error('DB ' + res.status + ': ' + t); }
  return res.json();
}
async function sbDelete(id, key) {
  const res = await fetch(SB_URL + '/rest/v1/claims?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE', headers: sbh(null, key)
  });
  const t = await res.text();
  if (!res.ok) throw new Error('DB ' + res.status + ': ' + (t || '(ditolak policy)'));
  return true;
}
async function sbPatch(id, obj, key) {
  const res = await fetch(SB_URL + '/rest/v1/claims?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: sbh('return=minimal', key), body: JSON.stringify(obj)
  });
  const t = await res.text();
  if (!res.ok) throw new Error('DB ' + res.status + ': ' + t);
  return true;
}
async function sbInsert(table, obj, key) {
  const res = await fetch(SB_URL + '/rest/v1/' + table, {
    method: 'POST', headers: sbh('return=minimal', key), body: JSON.stringify(obj)
  });
  const t = await res.text();
  if (!res.ok) throw new Error('DB ' + res.status + ': ' + t);
  return true;
}
async function sbDeleteRow(table, id, key) {
  const res = await fetch(SB_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE', headers: sbh(null, key)
  });
  const t = await res.text();
  if (!res.ok) throw new Error('DB ' + res.status + ': ' + (t || '(ditolak policy)'));
  return true;
}
async function sbPatchRow(table, id, obj, key) {
  const res = await fetch(SB_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: sbh('return=minimal', key), body: JSON.stringify(obj)
  });
  const t = await res.text();
  if (!res.ok) throw new Error('DB ' + res.status + ': ' + t);
  return true;
}

module.exports = {
  send, ok, denied, unauth, bad, fail, methodNotAllowed,
  readBody, clientIp, originOk, rateLimit,
  hmac, signSession, verifySession, readToken, readCookie, requireOwner, pinMatches, ownerOk,
  signStage, verifyStage, googleConfigured, ownerStepConfigured, userName, masterPassOk,
  signStaff, verifyStaffToken, readStaffToken, loadStaffRow, requireAccount,
  passHashSha, passCheckSha, ALL_PERMS,
  base32Decode, verifyTotp, totpLocked,
  loginGate, loginFail, loginOk,
  wibDayStartMs, iso,
  sbGet, sbDelete, sbPatch, sbInsert, sbDeleteRow, sbPatchRow, sbh, admKey,
  SB_URL, SB_KEY, SB_SVC, GOOGLE_CID, GOOGLE_CSEC, OW_GOOGLE
};