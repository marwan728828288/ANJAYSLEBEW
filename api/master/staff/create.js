'use strict';
/* POST /api/staff/create {username,password,fullname?,role?,perms[]?} → akun baru.
   Izin diambil dari role (ROLE_DEF) atau daftar perms jika disediakan. */
const L = require('../_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return L.methodNotAllowed(res);
  const acct = await L.requireAccount(req, res, 'staff');
  if (!acct) return;
  if (!process.env.SUPABASE_SERVICE_KEY) return L.fail(res, 'Supabase SERVICE KEY belum diatur.');

  let body;
  try { body = await L.readBody(req, 16 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }

  const username = String((body && body.username) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  const fullname = String((body && body.fullname) || '').trim().slice(0, 60);
  if (!/^[a-z0-9._@-]{3,64}$/.test(username)) return L.bad(res, 'BAD_USER', 'Username 3-64 karakter (a-z, 0-9, . _ @ -).');
  if (password.length < 8) return L.bad(res, 'BAD_PASS', 'Password minimal 8 karakter.');

  let perms = [];
  if (Array.isArray(body.perms) && body.perms.length) {
    perms = body.perms.filter(function (p) { return L.ALL_PERMS.indexOf(p) >= 0; });
    perms = Array.from(new Set(perms));
  } else {
    const role = String(body.role || 'STAFF').toUpperCase();
    if (role === 'ADMIN') perms = L.ALL_PERMS.slice();
    else perms = ['datalaim'];
  }
  if (!perms.length) perms = ['datalaim'];

  try {
    const ex = await L.sbGet('staff', 'select=id&username=eq.' + encodeURIComponent(username), process.env.SUPABASE_SERVICE_KEY);
    if (Array.isArray(ex) && ex.length) return L.bad(res, 'DUP', 'Username sudah dipakai.');
  } catch (e) {
    return L.fail(res, 'Tabel staff belum dibuat. Jalankan web/supabase/staff.sql di SQL Editor.');
  }

  try {
    await L.sbInsert('staff', {
      username, fullname,
      role: (perms.length === L.ALL_PERMS.length ? 'admin' : 'staff'),
      perms: perms,
      pass_hash: L.passHashSha(password),
      active: true
    }, process.env.SUPABASE_SERVICE_KEY);
    return L.ok(res, { ok: true });
  } catch (e) {
    return L.fail(res, 'Gagal menyimpan staff.');
  }
};