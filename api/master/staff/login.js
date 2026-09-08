'use strict';
/* POST /api/staff/login {username,password} → masuk sbg staff (tanpa PIN/2FA).
   Peran & izin ditarik dari DB tiap request (aman saat izin dicabut). */
const L = require('../_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return L.methodNotAllowed(res);
  const ip = L.clientIp(req);
  if (!L.originOk(req)) return L.denied(res);
  if (!process.env.SUPABASE_SERVICE_KEY) {
    return L.fail(res, 'Supabase SERVICE KEY belum diatur. Tambah SUPABASE_SERVICE_KEY di Vercel.');
  }

  let rl = L.rateLimit(ip, 60000, 10);
  if (!rl.ok) return L.send(res, 429, { ok: false, code: 'RATE', message: 'Terlalu sering mencoba. Tunggu sebentar.' });
  const gate = L.loginGate(ip);
  if (gate.block) {
    return L.send(res, 429, { ok: false, code: 'LOCKED', message: 'Terlalu banyak percobaan gagal. Coba lagi ' + Math.ceil(gate.retryAfterMs / 60000) + ' menit lagi.' });
  }

  let body;
  try { body = await L.readBody(req, 8 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }

  const username = String((body && body.username) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  if (!username || !password) return L.denied(res);

  let rows;
  try { rows = await L.sbGet('staff', 'select=*&username=eq.' + encodeURIComponent(username), process.env.SUPABASE_SERVICE_KEY); }
  catch (e) { return L.fail(res, 'Gagal membaca akun staff.'); }
  const row = (Array.isArray(rows) && rows[0]) || null;

  if (!row || row.active === false || !L.passCheckSha(row.pass_hash, password)) {
    L.loginFail(ip);
    return L.denied(res);
  }
  L.loginOk(ip);

  const ua = String(req.headers['user-agent'] || '');
  const token = L.signStaff(ip, ua, row.id);
  return L.ok(res, {
    ok: true,
    staff: { id: row.id, username: row.username, fullname: row.fullname || '', role: row.role || 'staff', perms: row.perms || [] }
  }, {
    'Set-Cookie': 'staff_tok=' + encodeURIComponent(token) + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + Math.floor(6 * 3600),
    'Cache-Control': 'no-store'
  });
};