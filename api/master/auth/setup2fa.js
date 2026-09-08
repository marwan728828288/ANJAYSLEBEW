'use strict';
/* POST /api/auth/setup2fa → tampilkan barcode 2FA + secret utk discan.
   Wajib tahap-A (Google) bila Google sudah dikonfigurasi.
   Mengembalikan otpauth:// utk digambar jadi QR di halaman master. */
const L = require('../_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return L.methodNotAllowed(res);
  const ip = L.clientIp(req);
  const rl = L.rateLimit(ip, 60000, 20);
  if (!rl.ok) return L.send(res, 429, { ok: false, code: 'RATE', message: 'Terlalu sering.' });
  if (!L.originOk(req)) return L.denied(res);

  let body;
  try { body = await L.readBody(req, 8 * 1024); }
  catch (e) { return L.bad(res, 'BAD_BODY', 'Data tidak terbaca.'); }

  const ua = String(req.headers['user-agent'] || '');
  const stage = String((body && body.stage) || '').trim() || L.readCookie(req, 'g_stage');

  if (L.ownerStepConfigured() && !L.verifyStage(stage, ip, ua)) {
    return L.send(res, 401, { ok: false, code: 'NEED_STEP1', message: 'Tahap 1 wajib: masukkan username & password pemilik dulu.' });
  }

  const secret = process.env.OWNER_TOTP_SECRET || '';
  const otpauth = secret
    ? 'otpauth://totp/AutoScater%20Master?secret=' + secret + '&issuer=AutoScater&algorithm=SHA1&digits=6&period=30'
    : '';

  return L.ok(res, {
    ok: true,
    configured: L.ownerStepConfigured(),
    username: L.userName(),
    secret: secret,
    otpauth: otpauth,
    enrolled: !!secret
  }, { 'Cache-Control': 'no-store' });
};