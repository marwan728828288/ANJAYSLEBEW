'use strict';
/* GET /api/staff/list → semua akun staff (butuh izin 'staff') */
const L = require('../_lib');

module.exports = async function (req, res) {
  if (req.method !== 'GET') return L.methodNotAllowed(res);
  const acct = await L.requireAccount(req, res, 'staff');
  if (!acct) return;
  if (!process.env.SUPABASE_SERVICE_KEY) return L.fail(res, 'Supabase SERVICE KEY belum diatur.');

  try {
    const rows = await L.sbGet('staff', 'select=id,username,fullname,role,perms,active,created_at', process.env.SUPABASE_SERVICE_KEY);
    return L.ok(res, { ok: true, rows: Array.isArray(rows) ? rows : [] });
  } catch (e) {
    return L.fail(res, 'Tabel staff belum dibuat. Jalankan web/supabase/staff.sql di SQL Editor Supabase.');
  }
};