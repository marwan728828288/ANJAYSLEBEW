'use strict';
/* POST /api/staff/logout → bersihkan cookie sesi staff */
const L = require('../_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return L.methodNotAllowed(res);
  return L.ok(res, { ok: true }, {
    'Set-Cookie': 'staff_tok=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    'Cache-Control': 'no-store'
  });
};