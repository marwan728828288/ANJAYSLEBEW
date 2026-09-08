'use strict';
/* GET /api/session → sesi aktif: owner (semua izin) atau staff (izin dari DB).
   401 bila tidak ada sesi → halaman master menampilkan login. */
const L = require('./_lib');

module.exports = async function (req, res) {
  if (req.method !== 'GET') return L.methodNotAllowed(res);
  const acct = await L.requireAccount(req, res, null);
  if (!acct) return;

  return L.ok(res, {
    ok: true,
    kind: acct.kind,
    perms: acct.perms,
    staff: acct.staff ? {
      id: acct.staff.id,
      username: acct.staff.username,
      fullname: acct.staff.fullname || '',
      role: acct.staff.role || 'staff'
    } : null
  }, { 'Cache-Control': 'no-store' });
};