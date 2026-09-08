'use strict';
/* POST /api/staff/update {id, fullname?, role?, perms?, active?, username?, password?} */
const L = require('../_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return L.methodNotAllowed(res);
  const acct = await L.requireAccount(req, res, 'staff');
  if (!acct) return;
  if (!process.env.SUPABASE_SERVICE_KEY) return L.fail(res, 'Supabase SERVICE KEY belum diatur.');

  let body;
  try { body = await L.readBody(req, 16 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }

  const id = String((body && body.id) || '').replace(/[^0-9a-f-]/gi, '');
  if (id.length !== 36) return L.bad(res, 'BAD_ID', 'ID tidak valid.');
  if (acct.kind === 'staff' && acct.staff && acct.staff.id === id) {
    return L.denied(res);  // jangan ubah akun sendiri
  }

  const patch = {};
  if (body.fullname !== undefined) patch.fullname = String(body.fullname).trim().slice(0, 60);
  if (body.username !== undefined) {
    const un = String(body.username).trim().toLowerCase();
    if (!/^[a-z0-9._@-]{3,64}$/.test(un)) return L.bad(res, 'BAD_USER', 'Username tidak valid.');
    patch.username = un;
  }
  if (Array.isArray(body.perms)) {
    patch.perms = Array.from(new Set(body.perms.filter(function (p) { return L.ALL_PERMS.indexOf(p) >= 0; })));
    patch.role = (patch.perms.length === L.ALL_PERMS.length) ? 'admin' : 'staff';
  } else if (body.role !== undefined) {
    if (String(body.role).toUpperCase() === 'ADMIN') { patch.role = 'admin'; patch.perms = L.ALL_PERMS.slice(); }
    else if (String(body.role).toUpperCase() === 'STAFF') { patch.role = 'staff'; if (patch.perms === undefined) patch.perms = ['datalaim']; }
    else return L.bad(res, 'BAD_ROLE', 'Role harus admin atau staff.');
  }
  if (body.active !== undefined) patch.active = !!body.active;
  if (body.password !== undefined && String(body.password).length >= 8) patch.pass_hash = L.passHashSha(String(body.password));
  if (!Object.keys(patch).length) return L.bad(res, 'BAD_PATCH', 'Tidak ada perubahan.');

  try {
    await L.sbPatchRow('staff', id, patch, process.env.SUPABASE_SERVICE_KEY);
    return L.ok(res, { ok: true });
  } catch (e) {
    return L.fail(res, 'Gagal mengubah staff.');
  }
};